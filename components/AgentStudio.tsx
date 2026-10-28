'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Card, Collapse, Input, Progress, Select, Space, Tag, Typography, message } from 'antd'
import { CheckCircle2, CircleStop, FlaskConical, Pause, Play, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { loadAgentApiKey, loadAgentApiPrefs, saveAgentApiPrefs } from '@/lib/agent-api-prefs'
import { AGENT_PROVIDERS, AGENT_ROLE_LABELS, LOCAL_AGENT_PROVIDERS, PROFESSIONAL_AGENT_ROLES, SYSTEM_AGENT_ROLES, getAgentProvider, getDefaultAgentModel, isLocalAgentProvider, localProviderConfig } from '@/lib/agents/config'
import { discoverLocalModels, safeLocalBaseUrl, testLocalAgentConnection } from '@/lib/agents/local-client'
import { inspectWebLlm, prepareWebLlm } from '@/lib/agents/webllm-client'
import { countBlockingIssues } from '@/lib/agents/validation'
import { latestPlanningIssues } from '@/lib/agents/review-status'
import { useAgentCluster } from '@/hooks/useAgentCluster'
import type { AgentExecuteRequest, AgentExecuteResponse, AgentProviderId, AgentTaskStatus, GameSpec } from '@/types'
import ApiPlatformGuide from './ui/ApiPlatformGuide'
import { getApiPlatformGuide } from '@/configs/api-platform-guide'
import { customConnectionError, EMPTY_CUSTOM_CONNECTION, loadAiAccessMode, loadCustomConnection, saveAiAccessMode, saveCustomConnection, type AiAccessMode, type CustomConnection } from '@/lib/custom-connection'
import AiAccessTabs from './ui/AiAccessTabs'
import CustomConnectionFields from './ui/CustomConnectionFields'
import AiProviderChoice from './ui/AiProviderChoice'
import ReadyAgentGuide, { READY_AGENT_VISUALS } from './ui/ReadyAgentGuide'
import StageHeading from './ui/StageHeading'
import GameSpecSummary from './ui/GameSpecSummary'
import NarrativeEditor, { type RefinementScope } from './ui/NarrativeEditor'
import WorkflowNotice, { type WorkflowFeedback } from './ui/WorkflowNotice'
import { pendingNarrativeSuggestions, sameSpecExceptSuggestions } from '@/lib/narrative-suggestions'
import { currentRunSpec, DRAFT_CHANGE_LABELS } from '@/lib/agents/draft-revision'

const { Paragraph, Text, Title } = Typography

interface AgentStudioProps {
  embedded?: boolean
  projectId: string
  sourcePrompt: string
  projectName: string
  briefReady: boolean
  levelCount: number
  baseSpec?: GameSpec | null
  onOptimizePrompt?: () => Promise<GameSpec | null>
  isOptimizing?: boolean
  onSpecReady: (spec: GameSpec) => void
  onApproved: (spec: GameSpec) => void
  onApprovedRestored?: (spec: GameSpec) => void
  onBusyChange?: (busy: boolean) => void
  onTextConnectionChange?: (connection: { provider?: AgentProviderId; model?: string; apiKey: string; baseUrl?: string }) => void
  reviewTarget?: HTMLDivElement | null
  inputRevision?: number
  onDraftChange?: (spec: GameSpec, suggestionsOnly?: boolean) => void
  onRefine?: (scope: RefinementScope) => void
  completionNotice?: React.ReactNode
  onEditStory?: () => void
  onContinueAssets?: () => void
  onPlanningStateChange?: (state: { label: string; approved: boolean }) => void
}

const STATUS_COLOR: Record<AgentTaskStatus, string> = {
  waiting: 'default', running: 'processing', completed: 'success', 'needs-review': 'warning', failed: 'error', cancelled: 'default',
}

const RUN_LABELS = {
  draft: '等待启动', planning: '策划中', reviewing: '交叉评审中', awaiting_approval: '等待确认', producing: '已批准，可生成素材',
  quality_check: '生成后检查中', ready: '试玩记录已齐，待人工验收', paused: '已暂停', failed: '需要处理', cancelled: '已取消',
} as const

function generatedAssetCount(spec?: GameSpec | null): number {
  if (!spec) return 0
  return spec.assets.filter((asset) => Boolean(asset.url) || Boolean(asset.animation?.clips && Object.values(asset.animation.clips).some((clip) => clip?.url))).length
}

function estimatedImageJobs(spec?: GameSpec | null): number {
  if (!spec) return 0
  return spec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet')).reduce((total, asset) => {
    if (asset.kind !== 'spriteSheet') return total + 1
    const clips = asset.animation?.clips ? Object.values(asset.animation.clips).filter((clip) => clip?.enabled).length : 1
    return total + Math.max(1, clips)
  }, 0)
}

function artifactPreview(output?: Record<string, unknown>): string {
  if (!output) return ''
  const json = JSON.stringify(output, null, 2)
  return json.length > 20000 ? `${json.slice(0, 20000)}\n…（内容过长，已在界面截断）` : json
}

export default function AgentStudio({ embedded = false, projectId, sourcePrompt, projectName, briefReady, levelCount, baseSpec, onOptimizePrompt, isOptimizing = false, onSpecReady, onApproved, onApprovedRestored, onBusyChange, onTextConnectionChange, reviewTarget, inputRevision = 0, onDraftChange, onRefine, completionNotice, onEditStory, onContinueAssets, onPlanningStateChange }: AgentStudioProps) {
  const [provider, setProvider] = useState<AgentProviderId>('openrouter')
  const [accessMode, setAccessMode] = useState<AiAccessMode>('ready')
  const [readyProvider, setReadyProvider] = useState<AgentProviderId | null>(null)
  const [ownProvider, setOwnProvider] = useState<AgentProviderId>('openrouter')
  const [customAgent, setCustomAgent] = useState<CustomConnection>(EMPTY_CUSTOM_CONNECTION)
  const [model, setModel] = useState(getDefaultAgentModel('openrouter'))
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<WorkflowFeedback | null>(null)
  const reviewInFlight = useRef(false)
  const [isCheckingDraft, setIsCheckingDraft] = useState(false)
  const [localModels, setLocalModels] = useState<Array<{ value: string; label: string }>>([])
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [localPassword, setLocalPassword] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [localCheck, setLocalCheck] = useState<{ state: 'idle' | 'checking' | 'ready' | 'failed'; text: string }>({ state: 'idle', text: '' })
  const [webLlmSetup, setWebLlmSetup] = useState<{ state: 'idle' | 'checking' | 'preparing' | 'ready' | 'failed'; progress: number; text: string; cached?: boolean }>({ state: 'idle', progress: 0, text: '' })
  const webLlmAttempt = useRef(0)
  const cluster = useAgentCluster({ projectId, sourcePrompt, projectName, levelCount, baseSpec, onSpecReady, onApproved, onApprovedRestored })
  const seenInputRevision = useRef(inputRevision)

  useEffect(() => {
    if (seenInputRevision.current === inputRevision) return
    seenInputRevision.current = inputRevision
    if (cluster.run) void cluster.reconcileInputs().catch(error => setActionFeedback({ tone: 'error', title: '修改尚未保存到策划记录', description: '当前草案仍在页面中，请重试检查；此时不会自动调用模型。', detail: error instanceof Error ? error.message : '保存失败。' }))
  }, [inputRevision, cluster.run, cluster.reconcileInputs])

  useEffect(() => {
    const prefs = loadAgentApiPrefs()
    const mode = loadAiAccessMode('agent')
    const savedReady = (localStorage.getItem('pixel-world-agent-ready-choice') || localStorage.getItem('pixel-local-provider')) as AgentProviderId | null
    const ready = savedReady && isLocalAgentProvider(savedReady) ? savedReady : null
    const own = localStorage.getItem('pixel-world-agent-own-choice') === 'custom' ? 'custom' : prefs.provider
    setAccessMode(mode)
    setReadyProvider(ready)
    setOwnProvider(own)
    setCustomAgent(loadCustomConnection('agent'))
    setProvider(mode === 'ready' ? ready || prefs.provider : own)
    setModel(mode === 'ready' && ready && isLocalAgentProvider(ready)
      ? localStorage.getItem(`pixel-local-model-${ready}`) || ''
      : mode === 'own' && own === 'custom' ? loadCustomConnection('agent').model : prefs.model)
    if (mode === 'ready' && ready && isLocalAgentProvider(ready)) {
      setBaseUrl(localStorage.getItem(`pixel-local-url-${ready}`) || localProviderConfig(ready).baseUrl || '')
    }
    setApiKey(prefs.apiKey)
  }, [])

  useEffect(() => {
    const selected = accessMode === 'own' || readyProvider !== null
    const chosenModel = provider === 'custom' ? customAgent.model.trim() : model.trim()
    if (!selected || !chosenModel || provider === 'managed') return onTextConnectionChange?.({ apiKey: '' })
    onTextConnectionChange?.({
      provider,
      model: chosenModel,
      apiKey: provider === 'custom' ? customAgent.apiKey.trim() : isLocalAgentProvider(provider) ? localPassword : apiKey.trim(),
      baseUrl: provider === 'custom' ? customAgent.baseUrl.trim() : isLocalAgentProvider(provider) && provider !== 'webllm' ? baseUrl.trim() : undefined,
    })
  }, [accessMode, readyProvider, provider, model, apiKey, customAgent, localPassword, baseUrl, onTextConnectionChange])

  const persist = (nextProvider = provider, nextModel = model, nextKey = apiKey) => {
    if (nextProvider !== 'custom' && nextProvider !== 'managed' && !isLocalAgentProvider(nextProvider)) saveAgentApiPrefs({ provider: nextProvider, model: nextModel, apiKey: nextKey })
  }

  const tasks = cluster.run?.tasks || []
  const completed = tasks.filter((task) => task.status === 'completed' || task.status === 'needs-review').length
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0
  const totalTokens = [...tasks, ...(cluster.run?.archivedTasks || [])].reduce((sum, task) => sum + (task.usage?.totalTokens || 0), 0)
  const issues = useMemo(() => {
    const quality = tasks.filter((task) => task.phase === 'quality')
    if (quality.length) return quality.flatMap((task) => task.issues || [])
    return cluster.run ? latestPlanningIssues(cluster.run) : []
  }, [cluster.run?.currentRound, tasks])
  const blocking = countBlockingIssues(issues)
  const locked = Boolean(cluster.run && cluster.run.reviewMode !== 'local-draft' && !['draft', 'cancelled'].includes(cluster.run.status))
  const busy = cluster.restoring || cluster.approving || Boolean(cluster.run && (
    ['planning', 'reviewing', 'quality_check'].includes(cluster.run.status)
    || cluster.run.tasks.some((task) => task.status === 'running')
  ))
  useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  useEffect(() => () => { onBusyChange?.(false) }, [onBusyChange])
  useEffect(() => {
    if (!locked || !cluster.run) return
    const lock = cluster.run.modelLock
    setProvider(lock.provider)
    if (lock.provider === 'custom') { setAccessMode('own'); setOwnProvider('custom') }
    else if (lock.provider === 'managed') { setAccessMode('ready'); setReadyProvider(null) }
    else if (isLocalAgentProvider(lock.provider)) { setAccessMode('ready'); setReadyProvider(lock.provider) }
    else { setAccessMode('own'); setOwnProvider(lock.provider) }
    setModel(lock.model)
    if (lock.baseUrl) setBaseUrl(lock.baseUrl)
    if (isLocalAgentProvider(lock.provider)) setLocalModels([{ value: lock.model, label: lock.model }])
  }, [locked, cluster.run?.modelLock.provider, cluster.run?.modelLock.model, cluster.run?.modelLock.baseUrl])
  useEffect(() => {
    onPlanningStateChange?.({ label: cluster.run ? RUN_LABELS[cluster.run.status] : baseSpec ? '草案待检查' : '尚未补全', approved: Boolean(cluster.run?.approved && cluster.run.sourcePrompt === sourcePrompt && cluster.run.levelCount === levelCount) })
  }, [cluster.run?.status, cluster.run?.approved, cluster.run?.sourcePrompt, cluster.run?.levelCount, sourcePrompt, levelCount, Boolean(baseSpec), onPlanningStateChange])
  const hasImages = generatedAssetCount(baseSpec) > 0
  const plannedSpec = !busy && baseSpec ? baseSpec : cluster.run ? currentRunSpec(cluster.run) : undefined
  const pendingRevision = cluster.run?.pendingRevision
  const inputChanged = seenInputRevision.current !== inputRevision
  const pendingSuggestions = pendingNarrativeSuggestions(plannedSpec || baseSpec).length
  const plannedJobs = estimatedImageJobs(plannedSpec)

  const changeProvider = (value: AgentProviderId) => {
    if (value === 'custom') {
      setProvider(value)
      setModel(customAgent.model)
      return
    }
    if (isLocalAgentProvider(value)) {
      setProvider(value)
      setModel(localStorage.getItem(`pixel-local-model-${value}`) || '')
      setBaseUrl(localStorage.getItem(`pixel-local-url-${value}`) || localProviderConfig(value).baseUrl || '')
      setLocalPassword('')
      setLocalModels([])
      setLocalCheck({ state: 'idle', text: '' })
      setWebLlmSetup({ state: 'idle', progress: 0, text: '' })
      webLlmAttempt.current += 1
      localStorage.setItem('pixel-local-provider', value)
      return
    }
    const savedPrefs = loadAgentApiPrefs()
    const nextModel = savedPrefs.provider === value ? savedPrefs.model : getDefaultAgentModel(value)
    const nextKey = loadAgentApiKey(value)
    setProvider(value)
    setModel(nextModel)
    setApiKey(nextKey)
    persist(value, nextModel, nextKey)
  }

  const changeAccessMode = (mode: AiAccessMode) => {
    setAccessMode(mode)
    saveAiAccessMode('agent', mode)
    if (mode === 'ready' && readyProvider) changeProvider(readyProvider)
    if (mode === 'own') changeProvider(ownProvider)
  }

  const selectProvider = (value: AgentProviderId) => {
    if (accessMode === 'ready') {
      setReadyProvider(value)
      localStorage.setItem('pixel-world-agent-ready-choice', value)
    } else {
      setOwnProvider(value)
      localStorage.setItem('pixel-world-agent-own-choice', value)
    }
    setActionFeedback(null)
    changeProvider(value)
  }

  const changeCustomAgent = (value: CustomConnection) => {
    setCustomAgent(value)
    saveCustomConnection('agent', value)
    if (provider === 'custom') setModel(value.model)
  }

  const selected = accessMode === 'own' || readyProvider !== null
  const legacyManagedRun = cluster.run?.modelLock.provider === 'managed'
  const activeKey = provider === 'custom' ? customAgent.apiKey.trim() : isLocalAgentProvider(provider) ? localPassword : apiKey.trim()
  const activeBaseUrl = provider === 'custom' ? customAgent.baseUrl.trim() : isLocalAgentProvider(provider) && provider !== 'webllm' ? safeLocalBaseUrl(baseUrl) : undefined
  const connectionIssue = !selected ? '内置规则无需测试；选择文字模型后才需要测试连接。'
    : provider === 'custom' ? customConnectionError(customAgent)
      : !model.trim() ? '请先检查本机服务或浏览器，再选择模型。'
        : !isLocalAgentProvider(provider) && !activeKey ? '请先填写自己的文字 API Key。' : null

  const testAgentApi = async () => {
    if (!selected) return void message.error('请先选择一个可用的文字 Agent 工具。')
    if (provider === 'custom') { const issue = customConnectionError(customAgent); if (issue) return void message.error(issue) }
    if (!isLocalAgentProvider(provider) && !activeKey) return void message.error('请先填写文字 Agent API Key。')
    if (!(provider === 'custom' ? customAgent.model : model).trim()) return void message.error('请先检测并选择模型。')
    setTesting(true)
    setActionFeedback(null)
    try {
      if (!isLocalAgentProvider(provider) && provider !== 'custom') {
        const body: AgentExecuteRequest = {
          runId: `agent-test-${Date.now()}`, taskId: 'director-test', role: 'director', round: 1,
          provider, model, apiKey: apiKey.trim(), sourcePrompt: 'Create a minimal original pixel platform game test brief.',
          projectName: 'Agent API Test', levelCount: 1, artifacts: {},
        }
        const response = await fetch('/api/agents/execute', { method: 'POST', signal: AbortSignal.timeout(55_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const result = await response.json().catch(() => null) as AgentExecuteResponse | null
        if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
        message.success(`Agent API 可用，锁定模型：${model}`)
        return
      }
      if (isLocalAgentProvider(provider)) {
        setLocalCheck({ state: 'checking', text: provider === 'webllm' ? '正在发送短文字测试…' : '正在向本机模型发送短文字测试…' })
        await testLocalAgentConnection(provider, model, activeBaseUrl, activeKey)
        setLocalCheck({ state: 'ready', text: '文字模型可用。完整 GameSpec 会在你启动 Agent 后才生成。' })
        message.success('文字模型已通过短测试。')
        return
      }
      const body: AgentExecuteRequest = {
        runId: `agent-test-${Date.now()}`, taskId: 'director-test', role: 'director', round: 1,
        provider, model: customAgent.model.trim(), apiKey: activeKey, baseUrl: activeBaseUrl,
        sourcePrompt: 'Create a minimal original pixel platform game test brief.', projectName: 'Agent API Test', levelCount: 1, artifacts: {},
      }
      const response = await fetch('/api/agents/execute', { method: 'POST', signal: AbortSignal.timeout(55_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null) as AgentExecuteResponse | null
      if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
      message.success(`自定义文字服务可用，锁定模型：${customAgent.model.trim()}`)
    } catch (error) {
      if (isLocalAgentProvider(provider)) setLocalCheck({ state: 'failed', text: error instanceof Error ? error.message : '本机文字模型测试失败。' })
      setActionFeedback({ tone: 'error', title: '文字模型测试未通过', description: '请检查模型配置。也可以先用内置规则生成草案，不需要等待模型恢复。', detail: error instanceof Error ? error.message : 'Agent API 测试失败。' })
    } finally {
      setTesting(false)
    }
  }

  const checkLocalTool = async () => {
    if (!isLocalAgentProvider(provider)) return
    setDiscovering(true)
    setLocalCheck({ state: 'checking', text: provider === 'webllm' ? '正在检查浏览器与可选模型…' : '正在检查本机服务与已加载模型…' })
    try {
      const models = await discoverLocalModels(provider, baseUrl, localPassword)
      setLocalModels(models.map((item) => ({ value: item.id, label: item.label })))
      if (!models.length) throw new Error(provider === 'webllm' ? '没有找到适合浏览器运行的 WebLLM 模型。' : '没有检测到已下载并加载的模型。')
      const selectedModel = models.some((item) => item.id === model) ? model : models[0].id
      setModel(selectedModel)
      if (provider === 'webllm') {
        const readiness = await inspectWebLlm(selectedModel)
        setWebLlmSetup({ state: readiness.cached ? 'checking' : 'idle', progress: readiness.cached ? 0 : 0, text: readiness.cached ? '浏览器已缓存该模型；仍需加载到显卡。' : '浏览器和模型列表可用；下一步准备模型。', cached: readiness.cached })
      }
      setLocalCheck({ state: 'ready', text: provider === 'webllm' ? '浏览器支持 WebLLM。请先准备模型，再进行短文字测试。' : `已找到 ${models.length} 个本机模型。请选择一个，再测试文字模型。` })
    } catch (error) {
      const text = error instanceof Error ? error.message : '模型检查失败。'
      setLocalCheck({ state: 'failed', text })
      if (provider === 'webllm') setWebLlmSetup({ state: 'failed', progress: 0, text })
      message.error(text)
    } finally {
      setDiscovering(false)
    }
  }

  const prepareBrowserModel = async () => {
    if (provider !== 'webllm' || !model.trim()) return void message.error('请先检查浏览器并选择模型。')
    const attempt = ++webLlmAttempt.current
    setWebLlmSetup({ state: 'preparing', progress: 0, text: '正在连接模型下载源…' })
    let timeout: number | undefined
    try {
      const prepared = prepareWebLlm(model, ({ progress, text }) => {
        if (webLlmAttempt.current === attempt) setWebLlmSetup({ state: 'preparing', progress, text })
      })
      await Promise.race([
        prepared,
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('模型准备超过 30 秒仍未完成。下载源或 WebGPU 可能没有响应；请改用 Ollama、LM Studio，或使用本地草案继续。')), 30_000) }),
      ])
      if (webLlmAttempt.current !== attempt) return
      setWebLlmSetup({ state: 'ready', progress: 1, text: '模型已加载到浏览器，可以测试文字模型。', cached: true })
      message.success('浏览器模型已经准备好。')
    } catch (error) {
      if (webLlmAttempt.current !== attempt) return
      const text = error instanceof Error ? error.message : '浏览器模型准备失败。'
      setWebLlmSetup({ state: 'failed', progress: 0, text })
      message.error(text)
      webLlmAttempt.current += 1
    } finally {
      if (timeout) window.clearTimeout(timeout)
    }
  }

  const start = async () => {
    if (isOptimizing) return
    if (!selected) return void message.error('请先选择一个可用的文字 Agent 工具。')
    if (provider === 'custom') { const issue = customConnectionError(customAgent); if (issue) return void message.error(issue) }
    if (!isLocalAgentProvider(provider) && !activeKey) return void message.error('请先填写文字 Agent API Key。')
    if (!(provider === 'custom' ? customAgent.model : model).trim()) return void message.error('请先检测并选择模型。')
    if (!baseSpec) return void message.error('请先补全提示词并检查草案，再启动 Agent 集群。')
    const modelLock = { provider, model: provider === 'custom' ? customAgent.model.trim() : model, baseUrl: activeBaseUrl }
    if (provider === 'webllm') {
      if (webLlmSetup.state !== 'ready') return void message.error('请先准备浏览器模型，再进行轻量灵感补全。')
      await cluster.reviewLocalDraft(baseSpec, modelLock)
      message.success('已用本地规则检查完整草案，等待你审核后制作素材。')
      return
    }
    const finished = await cluster.start(modelLock, activeKey, baseSpec)
    if (isLocalAgentProvider(provider) && finished.status === 'failed') {
      await cluster.reviewLocalDraft(baseSpec, modelLock)
      setActionFeedback({ tone: 'warning', title: '本机模型未完成完整策划', description: '已检查现有草案，你可以在中栏审核后继续制作素材。', detail: finished.error || finished.tasks.find((task) => task.error)?.error })
      message.warning('本机模型无法完成完整 Agent 评审，已切换为可审核的本地草案。')
    }
  }

  const runAgentAction = async (action: () => Promise<unknown>) => {
    if (isOptimizing) return
    try {
      if (legacyManagedRun) throw new Error('这个历史运行使用已移除的站点云端服务；请新建运行并选择文字工具。')
      await action()
    } catch (error) { setActionFeedback({ tone: 'error', title: '策划暂时无法继续', description: '可以重试失败步骤，或使用现有草案进入人工审核。', detail: error instanceof Error ? error.message : 'Agent 操作失败。' }) }
  }

  const checkDraft = async () => {
    if (!baseSpec || busy || isOptimizing || reviewInFlight.current) return
    reviewInFlight.current = true
    setIsCheckingDraft(true)
    setActionFeedback(null)
    try {
      // This lock is only a record: local-draft reviews never call a model.
      await cluster.reviewLocalDraft(baseSpec, { provider: selected ? provider : 'custom', model: selected ? model || customAgent.model : '内置规则（未调用文字模型）', baseUrl: activeBaseUrl })
    } catch (error) {
      setActionFeedback({ tone: 'error', title: '草案检查未完成', description: '当前草案已保留，可以重试检查。', detail: error instanceof Error ? error.message : '检查失败。' })
    } finally {
      reviewInFlight.current = false
      setIsCheckingDraft(false)
    }
  }
  const sourceLabel = !selected ? '内置规则整理：无需配置' : provider === 'webllm' ? '浏览器 AI：首次需要下载模型' : isLocalAgentProvider(provider) ? '本机 AI：需要安装并启动' : '使用我的文字 API：按服务商规则计费'
  const runActive = Boolean(cluster.run && !['draft', 'failed', 'cancelled'].includes(cluster.run.status))

  return <Card
    size="small"
    className={embedded ? 'agent-studio-embedded' : undefined}
    title={embedded ? undefined : <StageHeading number="02" title="文字策划" english="TEXT AGENTS" />}
    extra={!embedded && cluster.run && <Tag color={cluster.run.status === 'ready' ? 'success' : cluster.run.status === 'failed' ? 'error' : 'blue'}>{RUN_LABELS[cluster.run.status]}</Tag>}
  >
    {embedded && cluster.run && <div className="agent-embedded-status"><span>当前策划进度</span><Tag color={cluster.run.status === 'ready' ? 'success' : cluster.run.status === 'failed' ? 'error' : 'blue'}>{RUN_LABELS[cluster.run.status]}</Tag></div>}
    {legacyManagedRun && <div className="ai-ready-empty" role="status"><strong>历史云端运行只供查看</strong><span>站点体验已结束。要继续策划，请新建运行并选择本机工具或自己的 AI 服务。</span></div>}
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <div className="workflow-source-summary"><strong>{sourceLabel}</strong><span>{selected ? `${provider === 'custom' ? customAgent.displayName || '手动接入' : isLocalAgentProvider(provider) ? localProviderConfig(provider).label : getAgentProvider(provider).label} · ${provider === 'custom' ? customAgent.model || '尚未填写模型' : model || '尚未选择模型'}` : '按你的故事生成完整草案；不会调用文字 API。'}</span></div>
      <Collapse size="small" items={[{ key: 'text-settings', label: '选择文字来源与模型（可选）', children: <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <AiAccessTabs value={accessMode} onChange={changeAccessMode} kind="agent" disabled={locked} />
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Select<AgentProviderId | 'builtin'>
          aria-label="文字来源"
          value={selected ? provider : 'builtin'}
          disabled={locked}
          onChange={(value) => { if (value === 'builtin') { setReadyProvider(null); localStorage.removeItem('pixel-world-agent-ready-choice'); localStorage.removeItem('pixel-local-provider'); setActionFeedback(null) } else selectProvider(value) }}
          placeholder={accessMode === 'ready' ? '选择可用工具' : '选择服务商'}
          style={{ width: '100%' }}
          options={accessMode === 'own' ? [...AGENT_PROVIDERS.map((item) => {
            const guide = getApiPlatformGuide(item.id)
            return {
              value: item.id,
              label: <AiProviderChoice name={item.label} note={guide.strengths[0]} color={guide.accent} />,
            }
          }), { value: 'custom' as AgentProviderId, label: <AiProviderChoice name="手动接入其他服务" note="自定义接口" color="#317d70" /> }] : [{ value: 'builtin', label: <AiProviderChoice name="内置规则整理" note="无需配置" color="#338a70" /> }, ...LOCAL_AGENT_PROVIDERS.map((item) => ({ value: item.id as AgentProviderId, label: <AiProviderChoice name={item.label} note={READY_AGENT_VISUALS[item.id].note} color={READY_AGENT_VISUALS[item.id].color} /> }))]}
        />
        {selected && provider !== 'custom' && <Select
          value={model || undefined}
          disabled={locked}
          onChange={(value) => {
            setModel(value)
            if (isLocalAgentProvider(provider)) {
              localStorage.setItem(`pixel-local-model-${provider}`, value)
              setLocalCheck({ state: 'idle', text: '' })
              if (provider === 'webllm') {
                webLlmAttempt.current += 1
                setWebLlmSetup({ state: 'idle', progress: 0, text: '' })
              }
            } else persist(provider, value, apiKey)
          }}
          style={{ width: '100%' }}
          options={isLocalAgentProvider(provider) ? localModels : getAgentProvider(provider).models.map((item) => ({ value: item.id, label: item.label }))}
        />}
        {selected && provider !== 'custom' && provider !== 'managed' && !isLocalAgentProvider(provider) && <Input.Password
          value={apiKey}
          onChange={(event) => { const value = event.target.value; setApiKey(value); persist(provider, model, value) }}
          placeholder={getAgentProvider(provider).keyHint}
          style={{ width: '100%' }}
          autoComplete="new-password"
        />}
      </Space>

      {accessMode === 'ready' && !readyProvider && <div className="ai-ready-empty" role="status"><strong>当前使用内置规则整理</strong><span>可以直接补全草案。想让 AI 补充创意，再选择本机工具、浏览器模型或自己的 API。</span></div>}

      {selected && provider === 'custom' && <CustomConnectionFields kind="agent" value={customAgent} onChange={changeCustomAgent} disabled={locked} />}
      {selected && isLocalAgentProvider(provider) && <>
        <Space wrap style={{ width: '100%' }}>
          {provider !== 'webllm' && <Input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); localStorage.setItem(`pixel-local-url-${provider}`, event.target.value) }} placeholder="本地 API 地址" style={{ minWidth: 0, width: '100%' }} />}
          {provider !== 'webllm' && <Input.Password value={localPassword} onChange={(event) => setLocalPassword(event.target.value)} placeholder={provider === 'jan' ? 'Jan 本地访问密码（仅当前页面）' : '本地服务密码（如有，仅当前页面）'} style={{ minWidth: 0, width: '100%' }} />}
          <Button loading={discovering} onClick={() => { void checkLocalTool() }}>{provider === 'webllm' ? '检查浏览器' : '检查本机服务'}</Button>
        </Space>
        {provider === 'webllm' && <div className={`webllm-setup webllm-setup-${webLlmSetup.state}`}>
          <div className="webllm-setup-heading"><div><strong>准备浏览器模型</strong><span>首次需要下载并加载模型；这一步不生成 GameSpec。</span></div><Tag color={webLlmSetup.state === 'ready' ? 'success' : webLlmSetup.state === 'failed' ? 'error' : webLlmSetup.state === 'preparing' ? 'processing' : 'default'}>{webLlmSetup.state === 'ready' ? '已准备' : webLlmSetup.state === 'failed' ? '需要处理' : webLlmSetup.state === 'preparing' ? '准备中' : '未准备'}</Tag></div>
          {webLlmSetup.state === 'preparing' && <Progress percent={Math.round(webLlmSetup.progress * 100)} status="active" size="small" />}
          <p>{webLlmSetup.text || '先检查浏览器，再准备所选模型。模型下载源不可访问时会显示错误，不会把等待伪装成测试。'}</p>
          <Button type="primary" loading={webLlmSetup.state === 'preparing'} disabled={!model || webLlmSetup.state === 'ready'} onClick={() => { void prepareBrowserModel() }}>{webLlmSetup.state === 'ready' ? '浏览器模型已准备' : '准备模型'}</Button>
        </div>}
        {provider === 'webllm' && <Alert type="info" showIcon message="WebLLM 的工作方式" description="浏览器模型只做名称、故事和灵感的轻量补全；完整 GameSpec、关卡与素材清单由本地规则生成并交给你审核。它不会运行完整 Agent 集群，因此不会因 4096 上下文限制卡住。" />}
        {localCheck.state !== 'idle' && <Alert type={localCheck.state === 'ready' ? 'success' : localCheck.state === 'failed' ? 'error' : 'info'} showIcon message={localCheck.text} style={{ marginTop: 2 }} />}
      </>}
      {selected && accessMode === 'ready' && !legacyManagedRun && <Collapse size="small" items={[{ key: 'ready-help', label: '安装与使用说明', children: <ReadyAgentGuide provider={provider} /> }]} />}

      {selected && provider !== 'custom' && provider !== 'managed' && !isLocalAgentProvider(provider) && <Collapse size="small" items={[{ key: 'api-help', label: '平台接入说明', children: <ApiPlatformGuide selectedId={provider} mode="agent" /> }]} />}

      <Button icon={<FlaskConical size={14} />} disabled={Boolean(connectionIssue) || legacyManagedRun || testing || (provider === 'webllm' && webLlmSetup.state !== 'ready')} loading={testing} onClick={() => { void testAgentApi() }}>测试文字模型</Button>
      {connectionIssue && <Text type="secondary">{connectionIssue}</Text>}
      <Text type="secondary">测试、补全与 Agent 策划是独立调用；使用平台 API 可能收费。图片来源在做素材时单独选择。</Text>
      </Space> }]} />
      {completionNotice}
      {actionFeedback && <WorkflowNotice feedback={actionFeedback}><Button size="small" disabled={!baseSpec || busy || isOptimizing} onClick={() => { void checkDraft() }}>检查现有草案</Button><Button size="small" disabled={busy || isOptimizing} onClick={() => { changeAccessMode('ready'); setReadyProvider(null); localStorage.removeItem('pixel-world-agent-ready-choice'); localStorage.removeItem('pixel-local-provider'); setActionFeedback(null) }}>改用内置规则</Button></WorkflowNotice>}
      {pendingRevision && <WorkflowNotice feedback={{ tone: 'warning', title: '设定已修改，需要重新检查', description: `${pendingRevision.groups.map(group => DRAFT_CHANGE_LABELS[group]).join('、')}已更新。${cluster.run?.reviewMode === 'local-draft' ? '点击检查草案即可继续，不会调用文字模型。' : `保留 ${pendingRevision.retainedTaskIds.length} 项任务成果，更新其余受影响任务时继续使用已锁定模型。`}` }} />}
      <div className="agent-workflow-action">
        <Text strong>{busy ? '正在处理，请稍候' : cluster.run?.approved ? '规格已确认' : pendingRevision ? '选择如何重新检查' : cluster.run?.status === 'awaiting_approval' ? '请在中栏确认游戏内容' : baseSpec ? '草案已建立，下一步检查内容' : '先把故事补全为游戏草案'}</Text>
        <Text type="secondary">{!briefReady ? '请先在中栏填写名称和故事。' : busy ? '切换步骤不会中断任务；需要停止时请点击暂停或取消。' : cluster.run?.approved ? '接下来可用内置素材试玩，也可以选择上传或生成图片。' : pendingRevision ? cluster.run?.reviewMode === 'local-draft' ? '点击检查草案即可继续审核，不会调用文字模型。' : '可以更新受影响的 Agent 任务，也可以直接用本地规则检查当前草案。' : cluster.run?.status === 'awaiting_approval' ? '检查中栏的故事、主角和关卡。批准前不会调用图片 API。' : '补全后可以直接检查草案；想继续细化，可在下方选择完整 Agent 策划。'}</Text>
        {!runActive && !baseSpec && <Button type="primary" icon={<Sparkles size={14} />} loading={isOptimizing} disabled={!briefReady || busy || isOptimizing || legacyManagedRun} onClick={() => { void onOptimizePrompt?.() }}>一键补全并优化提示词</Button>}
        {!runActive && !cluster.run?.approved && baseSpec && <Button type="primary" loading={isCheckingDraft} disabled={busy || isOptimizing || !briefReady} onClick={() => { void checkDraft() }}>检查草案并进入审核</Button>}
        {cluster.run?.status === 'awaiting_approval' && <Button type="primary" loading={cluster.approving} disabled={isCheckingDraft || inputChanged || isOptimizing || blocking > 0 || pendingSuggestions > 0 || !cluster.run.artifacts.productionSpec} icon={<CheckCircle2 size={14} />} onClick={() => { void runAgentAction(cluster.approve) }}>批准规格并开放生图</Button>}
        {pendingSuggestions > 0 && <Text type="secondary">中栏有 {pendingSuggestions} 项模型修改建议。选择采用或保留原文后，再批准规格。</Text>}
        {cluster.run?.approved && <Button type="primary" onClick={onContinueAssets}>继续做素材 →</Button>}
        {cluster.run?.status === 'paused' && <Button type="primary" disabled={isOptimizing || legacyManagedRun} icon={<Play size={14} />} onClick={() => { void runAgentAction(() => cluster.resume(activeKey)) }}>{pendingRevision ? '更新受影响的任务' : '继续策划'}</Button>}
        {cluster.run?.status === 'paused' && pendingRevision && <Button disabled={!baseSpec || busy || isOptimizing} onClick={() => { void checkDraft() }}>只检查当前草案，进入人工审核</Button>}
        {cluster.run && ['planning', 'reviewing'].includes(cluster.run.status) && <Button icon={<Pause size={14} />} onClick={cluster.pause}>暂停</Button>}
        {cluster.run && ['planning', 'reviewing', 'paused', 'quality_check'].includes(cluster.run.status) && <Button danger icon={<CircleStop size={14} />} onClick={cluster.cancel}>取消</Button>}
        {baseSpec && !busy && <Button type="link" size="small" loading={isOptimizing} disabled={!briefReady || isOptimizing} onClick={() => { void onOptimizePrompt?.() }}>一键补全并优化提示词</Button>}
      </div>
      <Collapse size="small" items={[{ key: 'deep-planning', label: '可选：让 Agent 继续细化与评审', children: <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Text>多个 Agent 会继续策划、交叉评审并修订，耗时和调用次数更多；本次固定使用同一文字模型。WebLLM 只支持轻量补全。</Text>
        <Collapse size="small" items={[{ key: 'responsibilities', label: '十个专业职责分别做什么', children: <ol className="agent-responsibilities">{PROFESSIONAL_AGENT_ROLES.map(role => <li key={role}><b>{AGENT_ROLE_LABELS[role].zh}</b><span>{AGENT_ROLE_LABELS[role].description}</span><Tag>{role === 'visualQa' || role === 'playtest' ? '素材完成后' : '批准前'}</Tag></li>)}</ol> }]} />
        <Text type="secondary">规格整合、引擎规则和检查汇总由程序完成。视觉验收仅说明实际抽查的图片，试玩验收读取本浏览器的运行记录；未检查的部分会明确列出。</Text>
        <Button disabled={Boolean(connectionIssue) || provider === 'webllm' || !baseSpec || busy || isOptimizing || testing || locked || legacyManagedRun} icon={<Play size={14} />} onClick={() => { void runAgentAction(start) }}>启动 Agent 集群</Button>
        {(!selected || provider === 'webllm' || !baseSpec || locked) && <Text type="secondary">{!baseSpec ? '先补全草案，再选择是否继续细化。' : pendingRevision && locked ? '更新任务会沿用当前锁定模型，点击“更新受影响的任务”继续。' : locked ? '当前运行已锁定；重新策划前请新建运行。' : provider === 'webllm' ? '浏览器模型补全后，使用上方的草案检查继续。' : '需要先选择本机模型或自己的文字 API。'}</Text>}
        {cluster.run && <Button disabled={isOptimizing || busy} icon={<RotateCcw size={14} />} onClick={() => { void runAgentAction(cluster.reset) }}>新建运行（重新审核）</Button>}
        {cluster.run?.approved && hasImages && <Button icon={<ShieldCheck size={14} />} disabled={isOptimizing || legacyManagedRun || busy} onClick={() => baseSpec && void runAgentAction(() => cluster.runQualityChecks(baseSpec, activeKey))}>运行生成后检查</Button>}
      </Space> }]} />
      {cluster.savedRun && <Collapse size="small" items={[{ key: 'history', label: '查看上次策划记录（只读）', children: <><Text strong>{cluster.savedRun.projectName}</Text><Paragraph>{RUN_LABELS[cluster.savedRun.status]} · {cluster.savedRun.reviewMode === 'local-draft' ? '本地草案' : cluster.savedRun.modelLock.model}</Paragraph><Paragraph>这是历史记录，不会替当前故事批准规格。要继续修改，可在写故事中恢复上次草稿。</Paragraph><Collapse size="small" items={cluster.savedRun.tasks.map((task) => ({ key: task.id, label: AGENT_ROLE_LABELS[task.role].zh, children: <><Paragraph>{task.summary || task.error || task.status}</Paragraph>{task.output && <pre className="workflow-history-output">{artifactPreview(task.output)}</pre>}</> }))} /></> }]} />}
      {Boolean(cluster.run?.archivedTasks?.length) && <Collapse size="small" items={[{ key: 'revisions', label: '查看修改前的任务记录与用量', children: <Collapse size="small" items={cluster.run!.archivedTasks!.map((task, index) => ({ key: `${task.id}-${index}`, label: `${AGENT_ROLE_LABELS[task.role].zh} · ${task.usage?.totalTokens || 0} Token`, children: <><Paragraph>{task.summary || task.status}</Paragraph>{task.output && <pre className="workflow-history-output">{artifactPreview(task.output)}</pre>}</> }))} /> }]} />}

      {reviewTarget && createPortal(<div className="agent-review-content">
        {(plannedSpec || baseSpec) && <GameSpecSummary spec={(plannedSpec || baseSpec)!} imageJobs={estimatedImageJobs(plannedSpec || baseSpec)} onEdit={onEditStory} />}
        {(plannedSpec || baseSpec) && onDraftChange && <NarrativeEditor spec={(plannedSpec || baseSpec)!} onChange={next => {
          const suggestionsOnly = sameSpecExceptSuggestions((plannedSpec || baseSpec)!, next)
          if (suggestionsOnly) void runAgentAction(async () => { await cluster.updateSuggestionDecisions(next); onDraftChange(next, true) })
          else onDraftChange(next)
        }} onRefine={onRefine} disabled={busy || isOptimizing} />}
        {cluster.run && !['draft', 'cancelled'].includes(cluster.run.status) ? <>
        {cluster.run.reviewMode === 'local-draft' && <Alert type="info" showIcon message="本地草案待你审核" description="已运行规则检查，未运行完整 Agent 集群。请核对故事、所选灵感和关卡；有阻断项时先修改草案。" />}

        <div>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text>{cluster.run.reviewMode === 'local-draft' ? '规则检查' : '制作任务'} {completed}/{tasks.length}</Text>
            <Text type="secondary">{cluster.run.reviewMode === 'local-draft' ? '未调用文字模型' : `Token ${totalTokens.toLocaleString()}`} · 待处理 {blocking}</Text>
          </Space>
          <Progress percent={progress} status={cluster.run.status === 'failed' ? 'exception' : cluster.run.status === 'ready' ? 'success' : 'active'} />
        </div>
        {cluster.run.status === 'awaiting_approval' && plannedSpec && <Alert
          type={blocking ? 'warning' : 'success'}
          showIcon
          message={blocking ? `还有 ${blocking} 个问题需要修改` : '规则检查通过，等待你确认'}
          description={blocking ? '请按字段路径修改原始构想，再补全草案并重新检查；此时不会调用图片 API。' : `共 ${plannedSpec.assets.filter((asset) => asset.enabled).length} 个已启用素材、${plannedSpec.levels.length} 个关卡。批准后仍可在素材卡片中关闭项目或调整关卡分配。`}
        />}
        {cluster.run.error && <WorkflowNotice feedback={{ tone: 'error', title: '策划中断，已有结果已保留', description: '可在任务详情重试失败步骤，或检查现有草案进入人工审核。', detail: cluster.run.error }}><Button disabled={!baseSpec || busy} onClick={() => { void checkDraft() }}>检查现有草案</Button></WorkflowNotice>}
        <Collapse size="small" items={[{ key: 'task-details', label: '查看任务过程与技术详情', children: <Collapse
          size="small"
          items={tasks.filter(task => PROFESSIONAL_AGENT_ROLES.includes(task.role)).map((task) => {
            const label = AGENT_ROLE_LABELS[task.role]
            const actionableIssues = (task.issues || []).filter((item) => item.severity !== 'info')
            const advisoryIssues = (task.issues || []).filter((item) => item.severity === 'info')
            return {
              key: task.id,
              label: <Space wrap><Text strong>{task.id.startsWith('consistencyCritic-final-') ? '最终独立评审' : label.zh} / {label.en}</Text><Tag color={STATUS_COLOR[task.status]}>{task.status}</Tag>{pendingRevision?.retainedTaskIds.includes(task.id) && <Tag color="green">沿用成果</Tag>}{task.round > 1 && <Tag>第 {task.round} 轮</Tag>}</Space>,
              children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">{label.description}</Text>
                {task.summary && <Paragraph style={{ margin: 0 }}>{task.summary}</Paragraph>}
                {task.output && <Collapse size="small" items={[{
                  key: `${task.id}-artifact`,
                  label: '查看结构化成果',
                  children: <pre style={{ margin: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{artifactPreview(task.output)}</pre>,
                }]} />}
                {actionableIssues.map((item) => <Alert key={item.id} type={item.severity === 'blocking' ? 'error' : 'warning'} showIcon message={item.message} description={`${item.path} · ${item.suggestion}`} />)}
                {advisoryIssues.length > 0 && <Collapse size="small" items={[{
                  key: `${task.id}-advice`,
                  label: `可选优化建议 ${advisoryIssues.length} 条（不会阻止继续）`,
                  children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {advisoryIssues.map((item) => <Alert key={item.id} type="info" showIcon message={item.message} description={`${item.path} · ${item.suggestion}`} />)}
                  </Space>,
                }]} />}
                {task.error && <Alert type="error" showIcon message={task.error} />}
                <Space>
                  {task.usage && <Text type="secondary">Token: {task.usage.totalTokens}</Text>}
                  {(task.status === 'failed' || task.status === 'completed' || task.status === 'needs-review') && <Button size="small" disabled={isOptimizing || legacyManagedRun} icon={<RotateCcw size={12} />} onClick={() => { void runAgentAction(() => cluster.retryTask(task.id, activeKey)) }}>{task.status === 'failed' ? '重试该 Agent' : '重新运行该 Agent'}</Button>}
                </Space>
              </Space>,
            }
          })}
        /> }]} />
        <Collapse size="small" items={[{ key: 'program-checks', label: '程序整合与规则检查（不额外调用模型）', children: <Space direction="vertical" style={{ width: '100%' }}>{tasks.filter(task => SYSTEM_AGENT_ROLES.includes(task.role)).map(task => <section key={task.id}><Text strong>{AGENT_ROLE_LABELS[task.role].zh}</Text><Tag>{task.status}</Tag><Paragraph>{task.summary || '等待前面的成果。'}</Paragraph>{task.error && <Text type="danger">{task.error}</Text>}</section>)}</Space> }]} />
        {cluster.run.artifacts.releaseReport && <Card size="small" style={{ background: '#f6ffed' }}>
          <Title level={5} style={{ marginTop: 0 }}>发布检查</Title>
          <Paragraph style={{ marginBottom: 0 }}>{String(cluster.run.artifacts.releaseReport.summary || (cluster.run.artifacts.releaseReport.ready ? '所有阻断项已通过。' : '仍有需要处理的阻断项。'))}</Paragraph>
        </Card>}
      </> : <><div className="agent-review-empty"><strong>{baseSpec ? '草案已建立' : '等待补全设定'}</strong><span>{baseSpec ? '点击左栏“检查草案并进入审核”。无需运行完整 Agent，也能继续制作游戏。' : '先填写名称和故事，再点击左栏的一键补全。文字模型可选，不配置也能生成草案。'}</span></div></>}</div>, reviewTarget)}
    </Space>
  </Card>
}
