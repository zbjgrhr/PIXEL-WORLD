'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { loadLatestAgentRun, saveAgentRun } from '@/lib/agent-db'
import { createPlanningTasks, createQualityTasks, taskId } from '@/lib/agents/graph'
import { digestAgentInput } from '@/lib/agents/hash'
import { countBlockingIssues, dedupeIssues } from '@/lib/agents/validation'
import { stripLargeAssetUrls } from '@/lib/asset-db'
import type {
  AgentArtifacts,
  AgentExecuteRequest,
  AgentExecuteResponse,
  AgentIssue,
  AgentModelLock,
  AgentRole,
  AgentRun,
  AgentTask,
  GameSpec,
} from '@/types'

interface UseAgentClusterOptions {
  projectId: string
  sourcePrompt: string
  projectName: string
  levelCount: number
  baseSpec?: GameSpec | null
  onSpecReady?: (spec: GameSpec) => void
  onApproved?: (spec: GameSpec) => void
}

interface AgentCallResult {
  task: AgentTask
  response?: AgentExecuteResponse['data']
  error?: string
  recoverable?: boolean
}

const REVIEW_ROLES: AgentRole[] = ['consistencyCritic', 'engineQa']

function runId(): string {
  return `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createRun(options: UseAgentClusterOptions, modelLock: AgentModelLock): AgentRun {
  const now = Date.now()
  return {
    version: 1,
    id: runId(),
    projectId: options.projectId,
    sourcePrompt: options.sourcePrompt,
    projectName: options.projectName || 'Pixel World',
    levelCount: options.levelCount,
    status: 'draft',
    modelLock,
    maxReviewRounds: 2,
    currentRound: 1,
    approved: false,
    tasks: createPlanningTasks(1),
    artifacts: {},
    createdAt: now,
    updatedAt: now,
  }
}

function setTask(run: AgentRun, id: string, patch: Partial<AgentTask>): AgentRun {
  return { ...run, updatedAt: Date.now(), tasks: run.tasks.map((task) => task.id === id ? { ...task, ...patch } : task) }
}

function artifactForRole(artifacts: AgentArtifacts, role: AgentRole, artifact: Record<string, unknown>): AgentArtifacts {
  if (role === 'director') return { ...artifacts, brief: artifact as unknown as AgentArtifacts['brief'] }
  if (role === 'narrative') return { ...artifacts, narrative: artifact }
  if (role === 'mechanics') return { ...artifacts, mechanics: artifact }
  if (role === 'artDirector') return { ...artifacts, artDirection: artifact }
  if (role === 'levelDesigner') return { ...artifacts, levelPlan: artifact }
  if (role === 'integrator') return { ...artifacts, mergedSpec: artifact.spec as GameSpec }
  if (role === 'revision') return { ...artifacts, revisedSpec: artifact.spec as GameSpec }
  if (role === 'assetCoordinator') return { ...artifacts, productionSpec: artifact.spec as GameSpec }
  if (role === 'visualQa') return { ...artifacts, visualReport: artifact }
  if (role === 'playtest') return { ...artifacts, playtestReport: artifact }
  if (role === 'publisher') return { ...artifacts, releaseReport: artifact }
  return artifacts
}

function imageUrls(spec?: GameSpec): string[] {
  if (!spec) return []
  const urls = spec.assets.flatMap((asset) => {
    const clips = asset.animation?.clips ? Object.values(asset.animation.clips).map((clip) => clip?.url) : []
    return [asset.url, ...clips]
  })
  return [...new Set(urls.filter((url): url is string => Boolean(url && /^https:\/\//i.test(url))))].slice(0, 6)
}

function stripArtifactAssets(artifacts: AgentArtifacts): AgentArtifacts {
  return {
    ...artifacts,
    mergedSpec: artifacts.mergedSpec ? stripLargeAssetUrls(artifacts.mergedSpec) : undefined,
    revisedSpec: artifacts.revisedSpec ? stripLargeAssetUrls(artifacts.revisedSpec) : undefined,
    productionSpec: artifacts.productionSpec ? stripLargeAssetUrls(artifacts.productionSpec) : undefined,
  }
}

function blockingIssues(run: AgentRun): AgentIssue[] {
  const currentTasks = run.tasks.filter((task) => task.round === run.currentRound)
  const latestCompleted = currentTasks.find((task) => task.role === 'assetCoordinator' && task.status === 'completed')
    || currentTasks.find((task) => task.role === 'revision' && (task.status === 'completed' || task.status === 'needs-review'))
  const latestReview = latestCompleted
    ? latestCompleted.issues || []
    : currentTasks.filter((task) => REVIEW_ROLES.includes(task.role)).flatMap((task) => task.issues || [])
  return dedupeIssues(latestReview).filter((item) => item.severity === 'blocking')
}

function invalidatedTaskIds(tasks: AgentTask[], rootId: string): Set<string> {
  const invalidated = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const task of tasks) {
      if (!invalidated.has(task.id) && task.dependencies.some((dependency) => invalidated.has(dependency))) {
        invalidated.add(task.id)
        changed = true
      }
    }
  }
  return invalidated
}

function clearArtifactsForRoles(artifacts: AgentArtifacts, roles: Set<AgentRole>): AgentArtifacts {
  const next = { ...artifacts }
  if (roles.has('director')) delete next.brief
  if (roles.has('narrative')) delete next.narrative
  if (roles.has('mechanics')) delete next.mechanics
  if (roles.has('artDirector')) delete next.artDirection
  if (roles.has('levelDesigner')) delete next.levelPlan
  if (roles.has('integrator')) delete next.mergedSpec
  if (roles.has('revision')) delete next.revisedSpec
  if (roles.has('assetCoordinator')) delete next.productionSpec
  if (roles.has('visualQa')) delete next.visualReport
  if (roles.has('playtest')) delete next.playtestReport
  if (roles.has('publisher')) delete next.releaseReport
  if ([...roles].some((role) => REVIEW_ROLES.includes(role) || role === 'revision' || role === 'integrator')) delete next.reviewIssues
  return next
}

export function useAgentCluster(options: UseAgentClusterOptions) {
  const [run, setRunState] = useState<AgentRun | null>(null)
  const [restoring, setRestoring] = useState(true)
  const control = useRef<{ paused: boolean; cancelled: boolean; controller?: AbortController }>({ paused: false, cancelled: false })

  const publish = useCallback(async (next: AgentRun) => {
    setRunState(next)
    await saveAgentRun(next)
    return next
  }, [])

  useEffect(() => {
    let active = true
    void loadLatestAgentRun(options.projectId).then(async (stored) => {
      if (!active) return
      const interrupted = stored && (['planning', 'reviewing', 'quality_check'].includes(stored.status) || stored.tasks.some((task) => task.status === 'running'))
      const recovered: AgentRun | null = interrupted ? {
        ...stored,
        status: 'paused',
        tasks: stored.tasks.map((task) => task.status === 'running' ? { ...task, status: 'waiting', error: undefined } : task),
        updatedAt: Date.now(),
      } : stored
      if (recovered && interrupted) await saveAgentRun(recovered)
      if (!active) return
      setRunState(recovered)
      if (recovered?.artifacts.productionSpec) {
        options.onSpecReady?.(recovered.artifacts.productionSpec)
        if (recovered.approved) options.onApproved?.(recovered.artifacts.productionSpec)
      }
    }).finally(() => active && setRestoring(false))
    return () => { active = false }
  }, [options.projectId])

  const callTask = useCallback(async (current: AgentRun, task: AgentTask, apiKey: string, baseSpec?: GameSpec): Promise<AgentCallResult> => {
    const requestData = {
      role: task.role,
      round: task.round,
      sourcePrompt: current.sourcePrompt,
      projectName: current.projectName,
      levelCount: current.levelCount,
      modelLock: current.modelLock,
      artifacts: stripArtifactAssets(current.artifacts),
      baseSpec: baseSpec ? stripLargeAssetUrls(baseSpec) : undefined,
    }
    const digest = digestAgentInput(requestData)
    if ((task.status === 'completed' || task.status === 'needs-review') && task.inputDigest === digest) return { task }

    let lastError = 'Agent execution failed.'
    let recoverable = false
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const body: AgentExecuteRequest = {
          runId: current.id,
          taskId: task.id,
          role: task.role,
          round: task.round,
          provider: current.modelLock.provider,
          model: current.modelLock.model,
          apiKey,
          sourcePrompt: current.sourcePrompt,
          projectName: current.projectName,
          levelCount: current.levelCount,
          baseSpec: baseSpec ? stripLargeAssetUrls(baseSpec) : undefined,
          artifacts: stripArtifactAssets(current.artifacts),
          imageUrls: task.role === 'visualQa' ? imageUrls(baseSpec) : undefined,
        }
        const response = await fetch('/api/agents/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: control.current.controller?.signal,
          body: JSON.stringify(body),
        })
        const result = await response.json().catch(() => null) as AgentExecuteResponse | null
        if (!response.ok || !result?.success || !result.data) {
          lastError = result?.error || `Agent request failed (${response.status}).`
          recoverable = Boolean(result?.recoverable)
          if (recoverable && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
            continue
          }
          return { task: { ...task, inputDigest: digest, attempts: task.attempts + attempt }, error: lastError, recoverable }
        }
        return { task: { ...task, inputDigest: digest, attempts: task.attempts + attempt }, response: result.data }
      } catch (error) {
        if (control.current.cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return { task, error: 'Agent run cancelled.', recoverable: false }
        }
        lastError = error instanceof Error ? error.message : 'Agent request failed.'
        recoverable = true
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
    return { task, error: lastError, recoverable }
  }, [])

  const executeBatch = useCallback(async (current: AgentRun, ids: string[], apiKey: string, baseSpec?: GameSpec): Promise<AgentRun> => {
    const candidates = ids.map((id) => current.tasks.find((task) => task.id === id)).filter((task): task is AgentTask => Boolean(task))
    const tasks = candidates.filter((task) => task.status === 'waiting' || task.status === 'failed')
    if (!tasks.length) return current
    let working = current
    const startedAt = Date.now()
    for (const task of tasks) working = setTask(working, task.id, { status: 'running', startedAt, error: undefined })
    working = await publish(working)
    const snapshot = working
    const results = await Promise.all(tasks.slice(0, 3).map((task) => callTask(snapshot, task, apiKey, baseSpec)))
    for (const result of results) {
      if (result.error || !result.response) {
        working = setTask(working, result.task.id, {
          ...result.task,
          status: control.current.cancelled ? 'cancelled' : 'failed',
          error: result.error,
          completedAt: Date.now(),
        })
        continue
      }
      const response = result.response
      const status = countBlockingIssues(response.issues) > 0 && REVIEW_ROLES.includes(result.task.role) ? 'needs-review' : 'completed'
      working = setTask(working, result.task.id, {
        ...result.task,
        status,
        output: response.artifact,
        summary: response.summary,
        issues: response.issues,
        usage: response.usage,
        error: undefined,
        completedAt: Date.now(),
      })
      working = {
        ...working,
        artifacts: artifactForRole(working.artifacts, result.task.role, response.artifact),
        updatedAt: Date.now(),
      }
      if (REVIEW_ROLES.includes(result.task.role)) {
        working.artifacts = { ...working.artifacts, reviewIssues: dedupeIssues([...(working.artifacts.reviewIssues || []), ...response.issues]) }
      }
    }
    return publish(working)
  }, [callTask, publish])

  const drivePlanning = useCallback(async (initial: AgentRun, apiKey: string): Promise<AgentRun> => {
    let working: AgentRun = { ...initial, status: 'planning', error: undefined, updatedAt: Date.now() }
    control.current.controller = new AbortController()
    working = await publish(working)
    const stopIfNeeded = async () => {
      if (control.current.cancelled) {
        working = { ...working, status: 'cancelled', updatedAt: Date.now() }
        await publish(working)
        return true
      }
      if (control.current.paused) {
        working = { ...working, status: 'paused', updatedAt: Date.now() }
        await publish(working)
        return true
      }
      if (working.tasks.some((task) => task.status === 'failed')) {
        working = { ...working, status: 'failed', error: '一个或多个 Agent 任务失败，可单独重试后继续。', updatedAt: Date.now() }
        await publish(working)
        return true
      }
      return false
    }

    working = await executeBatch(working, [taskId('director', 1)], apiKey, options.baseSpec || undefined)
    if (await stopIfNeeded()) return working
    working = await executeBatch(working, [taskId('narrative', 1), taskId('mechanics', 1), taskId('artDirector', 1)], apiKey, options.baseSpec || undefined)
    if (await stopIfNeeded()) return working
    working = await executeBatch(working, [taskId('levelDesigner', 1)], apiKey, options.baseSpec || undefined)
    if (await stopIfNeeded()) return working
    working = await executeBatch(working, [taskId('integrator', 1)], apiKey, options.baseSpec || undefined)
    if (await stopIfNeeded()) return working
    working = { ...working, status: 'reviewing' }
    working = await executeBatch(working, [taskId('consistencyCritic', 1), taskId('engineQa', 1)], apiKey, working.artifacts.mergedSpec)
    if (await stopIfNeeded()) return working
    working = await executeBatch(working, [taskId('revision', 1)], apiKey, working.artifacts.mergedSpec)
    if (await stopIfNeeded()) return working

    if (blockingIssues(working).length && working.currentRound < working.maxReviewRounds) {
      const round = 2
      const secondTasks: AgentTask[] = [
        { id: taskId('consistencyCritic', round), role: 'consistencyCritic', phase: 'review', round, dependencies: [taskId('revision', 1)], status: 'waiting', attempts: 0 },
        { id: taskId('engineQa', round), role: 'engineQa', phase: 'review', round, dependencies: [taskId('revision', 1)], status: 'waiting', attempts: 0 },
        { id: taskId('revision', round), role: 'revision', phase: 'review', round, dependencies: [taskId('consistencyCritic', round), taskId('engineQa', round)], status: 'waiting', attempts: 0 },
      ]
      working = {
        ...working,
        currentRound: round,
        tasks: [...working.tasks.filter((task) => task.role !== 'assetCoordinator'), ...secondTasks, {
          id: taskId('assetCoordinator', round), role: 'assetCoordinator', phase: 'production', round,
          dependencies: [taskId('revision', round)], status: 'waiting', attempts: 0,
        }],
      }
      working = await publish(working)
      working = await executeBatch(working, [taskId('consistencyCritic', round), taskId('engineQa', round)], apiKey, working.artifacts.revisedSpec)
      if (await stopIfNeeded()) return working
      working = await executeBatch(working, [taskId('revision', round)], apiKey, working.artifacts.revisedSpec)
      if (await stopIfNeeded()) return working
    }

    if (blockingIssues(working).length) {
      const unresolvedSpec = working.artifacts.revisedSpec || working.artifacts.mergedSpec
      working = await publish({ ...working, status: 'awaiting_approval', approved: false, error: '两轮评审后仍有阻断项。请修改原始要求或相关规格，再重新运行对应 Agent。', updatedAt: Date.now() })
      if (unresolvedSpec) options.onSpecReady?.(unresolvedSpec)
      return working
    }

    const coordinatorId = taskId('assetCoordinator', working.currentRound)
    working = await executeBatch(working, [coordinatorId], apiKey, working.artifacts.revisedSpec || working.artifacts.mergedSpec)
    if (await stopIfNeeded()) return working
    const finalSpec = working.artifacts.productionSpec || working.artifacts.revisedSpec || working.artifacts.mergedSpec
    const productionBlocked = blockingIssues(working).length > 0
    working = { ...working, status: 'awaiting_approval', approved: false, error: productionBlocked ? '素材统筹后仍有阻断项，请修正后再批准生图。' : undefined, updatedAt: Date.now() }
    working = await publish(working)
    if (finalSpec) options.onSpecReady?.(finalSpec)
    return working
  }, [executeBatch, options.baseSpec, options.onSpecReady, publish])

  const start = useCallback(async (modelLock: AgentModelLock, apiKey: string) => {
    control.current = { paused: false, cancelled: false }
    const next = createRun(options, modelLock)
    await publish(next)
    return drivePlanning(next, apiKey)
  }, [drivePlanning, options, publish])

  const pause = useCallback(() => {
    control.current.paused = true
    setRunState((current) => current ? { ...current, status: 'paused', updatedAt: Date.now() } : current)
  }, [])

  const cancel = useCallback(() => {
    control.current.cancelled = true
    control.current.controller?.abort()
    setRunState((current) => current ? { ...current, status: 'cancelled', updatedAt: Date.now() } : current)
  }, [])

  const resume = useCallback(async (apiKey: string) => {
    if (!run) return null
    control.current = { paused: false, cancelled: false }
    const reset = {
      ...run,
      status: 'planning' as const,
      tasks: run.tasks.map((task) => task.status === 'cancelled' ? { ...task, status: 'waiting' as const, error: undefined } : task),
    }
    return drivePlanning(await publish(reset), apiKey)
  }, [drivePlanning, publish, run])

  const retryTask = useCallback(async (id: string, apiKey: string) => {
    if (!run) return null
    control.current = { paused: false, cancelled: false }
    const selected = run.tasks.find((task) => task.id === id)
    if (!selected) return null
    if (selected.phase === 'quality') {
      const resetIds = new Set([id, ...(selected.role === 'publisher' ? [] : [taskId('publisher', selected.round)])])
      let qualityRun: AgentRun = {
        ...run,
        status: 'quality_check',
        error: undefined,
        tasks: run.tasks.map((task) => resetIds.has(task.id) ? { ...task, status: 'waiting', error: undefined, output: undefined, summary: undefined, issues: undefined, usage: undefined, inputDigest: undefined } : task),
        artifacts: clearArtifactsForRoles(run.artifacts, new Set(selected.role === 'publisher' ? ['publisher'] : [selected.role, 'publisher'])),
      }
      qualityRun = await publish(qualityRun)
      qualityRun = await executeBatch(qualityRun, [id], apiKey, qualityRun.artifacts.productionSpec)
      const checksReady = qualityRun.tasks.filter((task) => task.phase === 'quality' && task.role !== 'publisher').every((task) => task.status === 'completed' || task.status === 'needs-review')
      if (selected.role !== 'publisher' && !checksReady) return qualityRun
      qualityRun = await executeBatch(qualityRun, [taskId('publisher', selected.round)], apiKey, qualityRun.artifacts.productionSpec)
      return publish({ ...qualityRun, status: qualityRun.artifacts.releaseReport?.ready ? 'ready' : 'awaiting_approval', updatedAt: Date.now() })
    }

    const firstRoundId = selected.round > 1 ? taskId(selected.role, 1) : selected.id
    const roundOneTasks = run.tasks.filter((task) => task.round === 1)
    const resetIds = invalidatedTaskIds(roundOneTasks, firstRoundId)
    const resetRoles = new Set(roundOneTasks.filter((task) => resetIds.has(task.id)).map((task) => task.role))
    const reset: AgentRun = {
      ...run,
      status: 'planning',
      currentRound: 1,
      approved: false,
      error: undefined,
      tasks: roundOneTasks.map((task) => resetIds.has(task.id) ? { ...task, status: 'waiting', error: undefined, output: undefined, summary: undefined, issues: undefined, usage: undefined, inputDigest: undefined } : task),
      artifacts: clearArtifactsForRoles(run.artifacts, resetRoles),
      updatedAt: Date.now(),
    }
    return drivePlanning(await publish(reset), apiKey)
  }, [drivePlanning, executeBatch, publish, run])

  const approve = useCallback(async () => {
    if (!run) return null
    const spec = run.artifacts.productionSpec || run.artifacts.revisedSpec || run.artifacts.mergedSpec
    if (!spec) return null
    const next = await publish({ ...run, approved: true, status: 'producing', updatedAt: Date.now() })
    options.onApproved?.(spec)
    return next
  }, [options.onApproved, publish, run])

  const runQualityChecks = useCallback(async (spec: GameSpec, apiKey: string) => {
    if (!run) return null
    control.current = { paused: false, cancelled: false, controller: new AbortController() }
    let working: AgentRun = {
      ...run,
      status: 'quality_check',
      approved: true,
      artifacts: { ...run.artifacts, productionSpec: stripLargeAssetUrls(spec) },
      tasks: [...run.tasks.filter((task) => task.phase !== 'quality'), ...createQualityTasks(1)],
      updatedAt: Date.now(),
    }
    working = await publish(working)
    working = await executeBatch(working, [taskId('visualQa', 1), taskId('playtest', 1)], apiKey, spec)
    if (working.tasks.some((task) => task.phase === 'quality' && task.status === 'failed')) return publish({ ...working, status: 'failed', error: '生成后检查失败，可单独重试。' })
    working = await executeBatch(working, [taskId('publisher', 1)], apiKey, spec)
    const ready = Boolean(working.artifacts.releaseReport?.ready)
    return publish({ ...working, status: ready ? 'ready' : 'awaiting_approval', updatedAt: Date.now() })
  }, [executeBatch, publish, run])

  const reset = useCallback(async () => {
    control.current.controller?.abort()
    control.current = { paused: false, cancelled: false }
    const next = createRun(options, run?.modelLock || { provider: 'openrouter', model: 'google/gemini-2.5-flash' })
    await publish(next)
    return next
  }, [options, publish, run?.modelLock])

  return { run, restoring, start, pause, cancel, resume, retryTask, approve, runQualityChecks, reset }
}
