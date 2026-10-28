import { sanitizeAgentArtifact, sanitizeSharedArtifacts } from '@/lib/agents/sanitize'
import { countBlockingIssues, dedupeIssues, inspectGameSpec, inspectPlayability, inspectVisualAssets, sanitizeIssues } from '@/lib/agents/validation'
import { createFallbackGameSpec, normalizeGameSpec } from '@/lib/game-spec'
import { stabilizeGameSpec } from '@/lib/game-spec-guardrails'
import { isStructuredPromptBlank } from '@/lib/asset-catalog'
import { inspectSelectedInspirations } from '@/lib/agents/inspiration-review'
import { agentModelSupportsVision } from './config'
import { playtestCoverage } from '@/lib/playtest-evidence'
import { normalizeModelGameSpec } from '@/lib/model-game-spec'
import { carryPendingNarrativeSuggestions } from '@/lib/narrative-suggestions'
import { alignGeneratedPassages } from '@/lib/narrative'
import type { AgentExecuteRequest, AgentExecuteResponse, AgentIssue, AgentRole, EnemySpec, GameSpec } from '@/types'

export interface ChatPayload {
  choices?: Array<{ finish_reason?: string | null; message?: { content?: string | Array<{ text?: string }> } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

export const ROLE_TOKEN_BUDGET: Record<AgentRole, number> = {
  director: 1000,
  narrative: 2400,
  mechanics: 2200,
  artDirector: 1600,
  levelDesigner: 3200,
  integrator: 2200,
  consistencyCritic: 2200,
  engineQa: 1600,
  revision: 3200,
  assetCoordinator: 2400,
  visualQa: 2400,
  playtest: 2400,
  publisher: 1800,
}

export function agentOutputBudget(request: AgentExecuteRequest): number {
  const levels = Math.min(10, Math.max(1, request.levelCount || 1))
  if (request.role === 'integrator' && request.runId.startsWith('prompt-optimize-')) return Math.min(6500, 1600 + levels * 650)
  if (request.role === 'levelDesigner') return Math.min(6500, 1600 + levels * 550)
  return ROLE_TOKEN_BUDGET[request.role]
}


export function responseText(payload: ChatPayload): string {
  const reason = payload.choices?.[0]?.finish_reason
  if (reason === 'error') throw new Error('文字服务在回答完成前中断了输出。已保留现有草案，请稍后重试当前步骤，或更换文字模型。')
  if (reason === 'length') throw new Error('文字模型的回答达到输出上限，内容尚未写完。已保留现有草案，请减少本次生成的关数或改用支持更长输出的模型。')
  if (reason === 'content_filter') throw new Error('文字服务拦截了本次回答。已保留现有草案，请检查内容或更换文字服务后重试。')
  const content = payload.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('')
  return ''
}

export function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Agent returned no JSON object.')
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Agent JSON must be an object.')
  return parsed as Record<string, unknown>
}

/** Compatible models sometimes put a revision patch directly in artifact instead of artifact.spec. */
export function hasUsableRevisionPatch(artifact: Record<string, unknown>): boolean {
  const patch = objectValue(artifact.spec || artifact)
  return ['title', 'world', 'backgroundStory', 'narrative', 'creativeBrief', 'visualStyle', 'hero', 'weapon', 'enemies', 'boss', 'collectible', 'projectile', 'attackEffect', 'levels', 'assets']
    .some(key => patch[key] !== undefined && patch[key] !== null && (typeof patch[key] !== 'string' || String(patch[key]).trim()))
}


function currentSpec(request: AgentExecuteRequest): GameSpec {
  const deterministicFallback = createFallbackGameSpec(request.sourcePrompt, request.projectName, request.levelCount)
  const candidate = request.artifacts.productionSpec
    || request.artifacts.revisedSpec
    || request.artifacts.mergedSpec
    || request.baseSpec
  if (!candidate) return deterministicFallback
  const source = request.baseSpec?.narrative?.source || candidate.narrative?.source
  const baseline = source && deterministicFallback.narrative ? { ...deterministicFallback, narrative: { ...deterministicFallback.narrative, source } } : deterministicFallback
  return stabilizeGameSpec(normalizeGameSpec(candidate, baseline, request.levelCount))
}

function normalizedSpec(request: AgentExecuteRequest, candidate: unknown): GameSpec {
  const fallback = carryPendingNarrativeSuggestions(currentSpec(request), objectValue(objectValue(request.artifacts.narrative).narrative).suggestions)
  const spec = normalizeModelGameSpec(candidate, fallback, request.levelCount, request.sourcePrompt)
  return { ...spec, assets: spec.assets.map(asset => {
    const platformMode = asset.category === 'airPlatform' ? 'air' : asset.category === 'waterPlatform' ? 'water' : undefined
    if (platformMode) {
      const levelIds = spec.levels.filter(level => level.platformMode === platformMode).map(level => level.id)
      return levelIds.length ? { ...asset, enabled: true, levelIds } : asset
    }
    const mobility = asset.category.startsWith('groundEnemy') ? 'ground' : asset.category.startsWith('airEnemy') ? 'air' : asset.category.startsWith('waterEnemy') ? 'water' : undefined
    if (!mobility) return asset
    const required = spec.levels.filter(level => level.platformMode === mobility && level.enemyCount > 0).map(level => level.id)
    const planned = plannedEnemyLevels(request, spec, asset.category)
    const compatible = spec.levels.filter(level => mobility === 'air' ? level.platformMode !== 'water' : level.platformMode === mobility).map(level => level.id)
    const existing = asset.enabled ? asset.levelIds.filter(id => compatible.includes(id)) : []
    const levelIds = [...new Set([...existing, ...required, ...planned.filter(id => compatible.includes(id))])]
    return { ...asset, enabled: (asset.enabled || required.length > 0 || planned.length > 0) && levelIds.length > 0, levelIds }
  }) }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hasChangedPatchField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasChangedPatchField)
  if (value && typeof value === 'object') return Object.entries(value).some(([key, item]) => !['id', 'levelId'].includes(key) && hasChangedPatchField(item))
  return value !== undefined && value !== null && value !== ''
}

function nonEmptyText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function plannedEnemyCategory(value: Record<string, unknown>, index: number): EnemySpec['category'] {
  if (['groundEnemy', 'airEnemy', 'waterEnemy'].includes(String(value.category))) return value.category as EnemySpec['category']
  const description = [value.behavior, value.appearance, value.attackPattern, value.name].join(' ')
  if (/(?:air|aerial|flying|floating|空中|飞行|漂浮)/i.test(description)) return 'airEnemy'
  if (/(?:water|aquatic|swim|水中|游泳|潜水)/i.test(description)) return 'waterEnemy'
  return (['groundEnemy', 'airEnemy', 'waterEnemy'] as const)[index] || 'groundEnemy'
}

function plannedEnemyLevels(request: AgentExecuteRequest, spec: GameSpec, category: string): string[] {
  const plans = Array.isArray(objectValue(request.artifacts.mechanics).enemies) ? objectValue(request.artifacts.mechanics).enemies as unknown[] : []
  const chapters = Array.isArray(objectValue(request.artifacts.levelPlan).levels) ? objectValue(request.artifacts.levelPlan).levels as unknown[] : []
  const matches = plans.map(objectValue).filter((plan, index) => plannedEnemyCategory(plan, index) === category)
  return [...new Set(matches.flatMap(plan => {
    const declared = Array.isArray(plan.spawnLevel) ? plan.spawnLevel.map(value => spec.levels[Number(value) - 1]?.id).filter((id): id is string => Boolean(id)) : []
    const scheduled = chapters.map(objectValue).filter(chapter => Array.isArray(chapter.enemyTypes)
      && chapter.enemyTypes.some((type: unknown) => [plan.id, plan.name, category].includes(type))).map(chapter => chapter.id).filter((id): id is string => typeof id === 'string')
    return declared.length && scheduled.length ? declared.filter(id => scheduled.includes(id)) : declared.length ? declared : scheduled
  }))]
}

function mechanicsEnemyPlans(value: unknown, base: GameSpec): unknown[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const enemy = objectValue(item)
    const behaviorText = [enemy.behavior, enemy.attackPattern].join(' ')
    const behavior: EnemySpec['behavior'] = ['chase', 'patrol', 'ranged'].includes(String(enemy.behavior))
      ? enemy.behavior as EnemySpec['behavior']
      : /(?:远程|投掷|射击|弹射|ranged|shoot|throw)/i.test(behaviorText) ? 'ranged'
        : /(?:巡逻|patrol)/i.test(behaviorText) ? 'patrol' : 'chase'
    const category = plannedEnemyCategory(enemy, index)
    const appearance = nonEmptyText(enemy.appearance, base.assets.find(asset => asset.category === category)?.prompt || base.enemies[0]?.appearance || '')
    return { ...enemy, appearance, behavior, category }
  })
}

function deterministicIntegratedSpec(request: AgentExecuteRequest): GameSpec {
  const base = currentSpec(request)
  const brief = objectValue(request.artifacts.brief)
  const narrative = objectValue(request.artifacts.narrative)
  const mechanics = objectValue(request.artifacts.mechanics)
  const art = objectValue(request.artifacts.artDirection)
  const levelPlan = objectValue(request.artifacts.levelPlan)
  const plannedLevels = Array.isArray(levelPlan.levels) && levelPlan.levels.length === request.levelCount
    ? levelPlan.levels
    : base.levels
  const candidate = {
    ...base,
    title: nonEmptyText(brief.title, base.title),
    world: nonEmptyText(narrative.world, base.world),
    backgroundStory: nonEmptyText(narrative.backgroundStory, base.backgroundStory),
    visualStyle: {
      ...base.visualStyle,
      artDirection: nonEmptyText(art.artDirection, base.visualStyle.artDirection),
      palette: nonEmptyText(art.palette, base.visualStyle.palette),
      lighting: nonEmptyText(art.lighting, base.visualStyle.lighting),
      pixelScale: nonEmptyText(art.pixelScale, base.visualStyle.pixelScale),
    },
    narrative: { ...base.narrative, ...objectValue(narrative.narrative), opening: objectValue(narrative.narrative).opening || narrative.backgroundStory || base.narrative?.opening, chapters: objectValue(levelPlan.narrative).chapters || base.narrative?.chapters },
    hero: objectValue(mechanics.hero),
    weapon: objectValue(mechanics.weapon),
    enemies: Array.isArray(mechanics.enemies) && mechanics.enemies.length ? mechanicsEnemyPlans(mechanics.enemies, base) : base.enemies,
    boss: objectValue(mechanics.boss),
    collectible: objectValue(mechanics.collectible),
    levels: plannedLevels,
  }
  const spec = normalizedSpec(request, candidate)
  return spec.narrative && Object.keys(narrative).length ? { ...spec, narrative: { ...spec.narrative, source: { ...spec.narrative.source, origin: 'model' } } } : spec
}

export function localIntegratorResponse(request: AgentExecuteRequest, error: unknown): AgentExecuteResponse {
  const spec = request.role === 'integrator' ? deterministicIntegratedSpec(request) : currentSpec(request)
  const issues = inspectGameSpec(spec, 'engineQa')
  const reason = error instanceof Error ? error.message : 'upstream Agent unavailable'
  const source = request.provider === 'ollama' || request.provider === 'lmstudio' || request.provider === 'gpt4all' || request.provider === 'jan' || request.provider === 'webllm'
    ? '本机模型未输出合格结构'
    : '文字服务未返回可用的整合结果'
  return {
    success: true,
    data: {
      role: request.role,
      artifact: { spec, localFallback: !String(reason).includes('无需再次调用'), execution: 'program' },
      summary: request.role === 'integrator'
        ? `已整合故事、玩法、美术与关卡成果，并完成程序检查；未调用额外整合模型。${String(reason).includes('无需再次调用') ? '' : `服务情况：${source}，${reason}`}`.slice(0, 1200)
        : `${source}，已保留并重新校验当前 GameSpec V3，后续流程可以继续。原因：${reason}`.slice(0, 1200),
      issues,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: request.provider,
      model: request.model,
    },
    timestamp: new Date().toISOString(),
  }
}

/** Numeric engine rules and an unchanged revision need no paid model call. */
export function deterministicAgentResponse(request: AgentExecuteRequest): AgentExecuteResponse | null {
  if (request.role === 'integrator' && !request.runId.startsWith('prompt-optimize-')) return localIntegratorResponse(request, new Error('已按职责成果在本地整合，无需再次调用模型。'))
  if (request.role === 'playtest' || request.role === 'publisher' || (request.role === 'visualQa' && (!request.imageUrls?.length || !agentModelSupportsVision(request.provider, request.model)))) {
    const { artifact, issues } = normalizeArtifact(request, { artifact: {} })
    return { success: true, data: { role: request.role, artifact: { ...artifact, execution: 'program' }, issues,
      summary: String(artifact.summary || '仅完成素材元数据检查；当前没有可供视觉模型检查的图片。'),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, provider: request.provider, model: request.model }, timestamp: new Date().toISOString() }
  }
  if (request.role !== 'engineQa' && !(request.role === 'revision' && !(request.artifacts.reviewIssues || []).some((item) => item.severity !== 'info'))) return null
  const spec = currentSpec(request)
  const issues = inspectGameSpec(spec, 'engineQa')
  return {
    success: true,
    data: {
      role: request.role,
      artifact: request.role === 'engineQa' ? { issues } : { spec },
      issues,
      summary: request.role === 'engineQa'
        ? `引擎规则已在本地检查，发现 ${countBlockingIssues(issues)} 个阻断项；此步骤未调用文字模型。`
        : '评审没有需要修订的内容，已保留当前规格；此步骤未调用文字模型。',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      provider: request.provider, model: request.model,
    },
    timestamp: new Date().toISOString(),
  }
}

export function normalizeArtifact(
  request: AgentExecuteRequest,
  parsed: Record<string, unknown>,
): { artifact: Record<string, unknown>; issues: AgentIssue[] } {
  const untrustedArtifact = parsed.artifact && typeof parsed.artifact === 'object' && !Array.isArray(parsed.artifact)
    ? parsed.artifact as Record<string, unknown>
    : parsed
  const rawArtifact = sanitizeAgentArtifact(request.role, untrustedArtifact)
  // Some compatible providers omit the outer artifact envelope. Read their
  // whitelisted role fields, but never count an empty plan as a successful step.
  const authorRoles: AgentRole[] = ['director', 'narrative', 'mechanics', 'artDirector', 'levelDesigner', 'assetCoordinator']
  const hasContent = (value: unknown): boolean => typeof value === 'string' ? Boolean(value.trim())
    : Array.isArray(value) ? value.some(hasContent)
      : value !== null && typeof value === 'object' ? Object.values(value).some(hasContent) : false
  const explicitNoAssetChanges = request.role === 'assetCoordinator' && Array.isArray(rawArtifact.assetPromptPatches)
  if (authorRoles.includes(request.role) && !explicitNoAssetChanges && !Object.values(rawArtifact).some(hasContent)) {
    throw new Error('文字模型没有返回此步骤所需的有效策划内容，原草案已保留。请重试此步骤，或使用本地草案继续审核。')
  }
  if (request.role === 'levelDesigner' && !Array.isArray(rawArtifact.levels) && !Array.isArray(objectValue(rawArtifact.narrative).chapters)) {
    throw new Error('关卡策划没有返回关卡或章节内容，原草案已保留。请重试关卡策划。')
  }
  let artifact = rawArtifact
  let issues = sanitizeIssues(parsed.issues, request.role)

  if (request.role === 'narrative') {
    const base = currentSpec(request)
    const candidate = { world: rawArtifact.world, backgroundStory: rawArtifact.backgroundStory, narrative: rawArtifact.narrative }
    const spec = normalizeModelGameSpec(candidate, base, request.levelCount, request.sourcePrompt)
    // Other specialists need the accepted story, not duplicated chapter tasks or provenance.
    const story = spec.narrative ? Object.fromEntries(Object.entries(spec.narrative).filter(([key]) => key !== 'chapters' && key !== 'source')) : undefined
    artifact = { ...rawArtifact, world: spec.world, backgroundStory: spec.narrative?.opening || spec.backgroundStory, narrative: story, conflict: spec.narrative?.conflict, heroGoal: spec.narrative?.motivation, bossRole: spec.narrative?.bossRelation }
  } else if (request.role === 'integrator' || request.role === 'revision') {
    const candidate = untrustedArtifact.spec || parsed.spec || untrustedArtifact
    const patch = objectValue(candidate)
    const recognized = ['title', 'world', 'backgroundStory', 'narrative', 'creativeBrief', 'visualStyle', 'hero', 'weapon', 'enemies', 'boss', 'collectible', 'projectile', 'attackEffect', 'levels', 'assets']
    if (!recognized.some(key => patch[key] !== undefined && patch[key] !== null && (typeof patch[key] !== 'string' || String(patch[key]).trim()))) throw new Error('文字模型没有返回可用的设定字段，已有草案已保留。')
    // A story-only revision may include an unrelated platformMode suggestion.
    // Preserve the already reviewed movement physics unless this round's
    // review explicitly requested a platform-mode change.
    const platformModeInReview = request.artifacts.reviewIssues?.some(issue => /platformMode|平台模式|地面平台|空中平台|水中平台/i.test(`${issue.path} ${issue.message}`)) ?? false
    const safeLevelPatch = request.role === 'revision' && !platformModeInReview && Array.isArray(patch.levels)
      ? { ...patch, levels: patch.levels.map(level => {
          const item = objectValue(level)
          const { platformMode: _ignored, ...rest } = item
          return rest
        }) }
      : patch
    // Revision may correct wording and counts, but cannot redefine the runtime
    // event contract of an existing objective while repairing its prose.
    const narrativePatch = objectValue(safeLevelPatch.narrative)
    const safePatch = request.role === 'revision' && Array.isArray(narrativePatch.chapters)
      ? { ...safeLevelPatch, narrative: { ...narrativePatch, chapters: narrativePatch.chapters.map(rawChapter => {
          const chapter = objectValue(rawChapter)
          const existing = currentSpec(request).narrative?.chapters.find(item => item.levelId === chapter.levelId)
          if (!existing || !Array.isArray(chapter.objectives)) return chapter
          return { ...chapter, objectives: chapter.objectives.flatMap(rawObjective => {
            const objective = objectValue(rawObjective)
            if (!existing.objectives.some(item => item.id === objective.id)) return []
            const { kind: _kind, target: _target, prerequisites: _prerequisites, ...safeObjective } = objective
            return [safeObjective]
          }) }
        }) } }
      : safeLevelPatch
    const passageRepair = request.role === 'revision'
      ? alignGeneratedPassages(normalizedSpec(request, safePatch))
      : { spec: normalizedSpec(request, safePatch), repairedPaths: [] }
    const spec = passageRepair.spec
    const modeled = spec.narrative ? { ...spec, narrative: { ...spec.narrative, source: { ...spec.narrative.source, origin: 'model' as const } } } : spec
    if (request.role === 'revision') {
      const prior = currentSpec(request), priorIssues = inspectGameSpec(prior, 'engineQa')
      if ((!hasChangedPatchField(safePatch) && !passageRepair.repairedPaths.length || JSON.stringify(spec) === JSON.stringify(prior)) && (request.artifacts.reviewIssues || []).some(issue => issue.severity === 'blocking')) {
        const unchanged: AgentIssue = { id: 'revision-no-effective-change', source: 'revision', severity: 'warning', path: 'spec', message: '本次修订没有改变被评审的内容，已保留原规格与待处理问题。', suggestion: '针对评审路径修改实际的故事或任务字段。' }
        return { artifact: { spec: prior, patchRejected: true }, issues: dedupeIssues([...(request.artifacts.reviewIssues || []), ...priorIssues, unchanged]) }
      }
      const priorKeys = new Set(priorIssues.filter(issue => issue.severity === 'blocking').map(issue => `${issue.path}:${issue.message}`))
      const regressions = inspectGameSpec(spec, 'engineQa').filter(issue => issue.severity === 'blocking' && !priorKeys.has(`${issue.path}:${issue.message}`))
      if (regressions.length) {
        const rejected: AgentIssue = { id: 'revision-structure-regression', source: 'revision', severity: 'warning', path: 'spec', message: `本次修订引入 ${regressions.length} 项新的程序问题，已保留修订前的规格。`, suggestion: '根据原评审问题重新定向修订；现有可用内容与玩家输入均已保留。' }
        return { artifact: { spec: prior, patchRejected: true, rejectedProblems: regressions }, issues: dedupeIssues([...(request.artifacts.reviewIssues || []), ...priorIssues, rejected]) }
      }
    }
    artifact = { ...rawArtifact, spec: modeled }
    issues = dedupeIssues([...issues, ...inspectGameSpec(spec, 'engineQa'),
      ...(passageRepair.repairedPaths.length ? [{ id: 'revision-align-existing-exit', source: 'revision' as const, severity: 'warning' as const,
        path: 'narrative', message: `已将 ${passageRepair.repairedPaths.length} 处模型编出的暗道或接口改为现有出口可通行。`,
        suggestion: '请在规格审核中确认改写后的剧情是否符合你的构想。' }] : [])])
  } else if (request.role === 'assetCoordinator') {
    const base = currentSpec(request)
    const patches = Array.isArray(rawArtifact.assetPromptPatches) ? rawArtifact.assetPromptPatches : []
    const promptById = new Map<string, string>()
    for (const candidate of patches.slice(0, 100)) {
      if (!candidate || typeof candidate !== 'object') continue
      const item = candidate as Record<string, unknown>
      if (typeof item.assetId === 'string' && typeof item.prompt === 'string' && item.prompt.trim()) {
        promptById.set(item.assetId.slice(0, 160), item.prompt.trim().slice(0, 8000))
      }
    }
    const candidate = {
      ...base,
      assets: base.assets.map((asset) => promptById.has(asset.id) ? { ...asset, prompt: promptById.get(asset.id)! } : asset),
    }
    const spec = normalizedSpec(request, candidate)
    const estimatedImageJobs = spec.assets.filter((asset) => asset.enabled).reduce((total, asset) => {
      if (asset.kind === 'spriteSheet') {
        return total + Object.values(asset.animation?.clips || {}).filter((clip) => clip?.enabled !== false).length
      }
      return total + (asset.kind === 'image' ? 1 : 0)
    }, 0)
    artifact = { ...rawArtifact, estimatedImageJobs, spec }
    // Visual prompt refinements are advice. Only deterministic spec checks can
    // block approval at this stage; a model may otherwise call a cosmetic gap
    // "blocking" even after its own patch fixes the prompt.
    issues = dedupeIssues([...issues.map(issue => issue.severity === 'blocking' ? { ...issue, severity: 'warning' as const } : issue), ...inspectGameSpec(spec, 'engineQa')])
  } else if (request.role === 'consistencyCritic') {
    const reviewedSpec = currentSpec(request)
    const reported = sanitizeIssues(rawArtifact.issues, 'consistencyCritic').map(item => {
      const levelIndex = Number(item.path.match(/^levels\[(\d+)\]\.enemyCount$/)?.[1])
      const chapterIndex = Number(item.path.match(/^narrative\.chapters\[(\d+)\]/)?.[1])
      const level = reviewedSpec.levels[Number.isInteger(levelIndex) ? levelIndex : chapterIndex]
      if (level?.hasBoss && level.enemyCount <= 5 && /Boss/i.test(item.message) && /(?:容纳|占满|不含|超过|上限)/.test(item.message)) {
        return { ...item, severity: 'warning' as const, message: '最终关的普通敌人数符合上限；仍需试玩确认与 Boss 同场时的战斗密度。', suggestion: '实际试玩最终关，再决定是否减少普通敌人。' }
      }
      if (item.severity === 'blocking' && /(?:Boss任务|Boss 任务|击败守钟机械).{0,35}(?:认出|识别)|逻辑识别类Boss机制/i.test(item.message)
        && !/(?:不能|不可|不要|不许|禁止).{0,12}(?:攻击|伤害|击败)|和平解决|说服.*(?:Boss|机械)/i.test(reviewedSpec.narrative?.source.originalStory || '')) {
        return { ...item, severity: 'warning' as const, message: '普通 Boss 战可以在战后通过剧情呈现认出真相；请检查战后反馈和结局是否保留玩家的原因与结果。', suggestion: '保留可玩的普通战斗，并在战后文字中说明误认如何解除。' }
      }
      if (item.severity === 'blocking' && /^narrative\.clues\[\d+\]\.payoff$/.test(item.path)
        && /(?:Boss|战斗|交战).{0,12}(?:前|之前)/i.test(item.message)) {
        return { ...item, severity: 'warning' as const, message: '线索回应在指定关卡出口展示；若必须在 Boss 战前知道，请在此前的交互反馈中说明。', suggestion: '检查战前交互是否已经提供足够线索，并避免出口重复揭示。' }
      }
      return item
    })
    issues = dedupeIssues([...issues, ...reported, ...inspectSelectedInspirations(request.sourcePrompt, currentSpec(request)),
      ...(request.taskId.startsWith('consistencyCritic-final-') ? inspectGameSpec(reviewedSpec, 'engineQa') : [])])
    artifact = { ...rawArtifact, issues }
  } else if (request.role === 'engineQa') {
    issues = dedupeIssues([...issues, ...sanitizeIssues(rawArtifact.issues, 'engineQa'), ...inspectGameSpec(currentSpec(request), 'engineQa')])
    artifact = { ...rawArtifact, issues }
  } else if (request.role === 'visualQa') {
    const spec = currentSpec(request)
    const canInspect = agentModelSupportsVision(request.provider, request.model)
    const reported = Array.isArray(rawArtifact.checkedAssets) ? rawArtifact.checkedAssets.filter(label => typeof label === 'string') : []
    const checked = canInspect ? (request.imageLabels || []).slice(0, request.imageUrls?.length || 0).filter(label => reported.includes(label)) : []
    const total = spec.assets.filter(a => a.enabled && (a.kind === 'image' || a.kind === 'spriteSheet')).reduce((sum, a) => sum + (a.kind === 'spriteSheet' ? Object.values(a.animation?.clips || {}).filter(c => c?.enabled !== false).length || 1 : 1), 0)
    issues = dedupeIssues([...issues, ...inspectVisualAssets(spec), ...(checked.length < total ? [{ id: 'visual-coverage', source: 'visualQa' as const, severity: 'warning' as const, path: 'visual.coverage', message: `视觉抽查 ${checked.length}/${total} 张；未抽查的素材不能判定画面合格。`, suggestion: '在素材工坊逐项查看剩余图片和动作；抽查不能代替完整人工验收。' }] : [])])
    artifact = { ...rawArtifact, issues, checkedAssets: checked, coverage: { checked: checked.length, total, status: !checked.length ? 'not-inspected' : checked.length < total ? 'sampled' : 'inspected' }, blockingCount: countBlockingIssues(issues) }
  } else if (request.role === 'playtest') {
    const spec = currentSpec(request)
    const coverage = playtestCoverage(spec, request.playtestEvidence)
    issues = dedupeIssues([...issues, ...inspectPlayability(spec), ...(coverage.status === 'observed-complete' ? [] : [{ id: 'playtest-evidence', source: 'playtest' as const, severity: 'warning' as const, path: 'playtest.coverage', message: coverage.summary, suggestion: '在右栏实际试玩，完成各关任务和结局后重新检查。' }])])
    artifact = { ...rawArtifact, ...coverage, summary: coverage.summary, verdict: coverage.status, issues, blockingCount: countBlockingIssues(issues) }
  } else if (request.role === 'publisher') {
    const shared = [
      ...(request.artifacts.reviewIssues || []),
      ...sanitizeIssues(request.artifacts.visualReport?.issues, 'visualQa'),
      ...sanitizeIssues(request.artifacts.playtestReport?.issues, 'playtest'),
      ...issues,
    ]
    issues = dedupeIssues(shared)
    artifact = {
      ...rawArtifact,
      ready: countBlockingIssues(issues) === 0 && request.artifacts.playtestReport?.status === 'observed-complete' && request.artifacts.visualReport?.coverage != null,
      summary: countBlockingIssues(issues) ? '存在制作或运行配置问题，请先处理。' : request.artifacts.playtestReport?.status !== 'observed-complete' ? '规格检查完成，但真实试玩尚未全部完成。你可以继续试玩与导出，不能据此宣称已全面验收。' : '已记录本浏览器的任务与通关过程。请结合视觉抽查范围，人工确认画面、操作手感和离线版本。',
      blockingIssues: issues.filter((item) => item.severity === 'blocking'),
      warnings: issues.filter((item) => item.severity === 'warning'),
    }
  }
  return { artifact, issues }
}


export function prepareAgentRequest(body: AgentExecuteRequest): AgentExecuteRequest {
  const submittedSourcePrompt = String(body.sourcePrompt || '').trim().slice(0, 50000)
  return {
    ...body,
    sourcePrompt: isStructuredPromptBlank(submittedSourcePrompt)
      ? 'Complete and review an original colorful pixel platform adventure using the supplied GameSpec V3. Fill all missing requirements without overriding established choices.'
      : submittedSourcePrompt,
    projectName: String(body.projectName || 'Pixel World').trim().slice(0, 160),
    levelCount: Math.min(10, Math.max(1, Math.round(Number(body.levelCount) || 1))),
    artifacts: sanitizeSharedArtifacts(body.artifacts),
    imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.filter((url) => typeof url === 'string' && (/^https:\/\//i.test(url) || (url.length <= 1_000_000 && /^data:image\/(?:png|jpeg|webp);base64,/i.test(url)))).slice(0, 6) : undefined,
    imageLabels: Array.isArray(body.imageLabels) ? body.imageLabels.filter(label => typeof label === 'string').slice(0, 6).map(label => label.slice(0, 180)) : undefined,
  }
}
