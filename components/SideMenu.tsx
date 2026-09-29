'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Select, Space, Alert, message } from 'antd'
import { useGameStore } from '@/lib/store'
import { isPresetTheme } from '@/lib/theme-utils'
import { ActionButtons, AgentStudio, AssetPlanner, ModelSelector, ThemeCustomizer } from './ui/index'
import { buildGameDataFromSpec, syncPlayableLevels } from '@/lib/virtual-levels'
import { formatGenerationError } from '@/lib/format-generation-error'
import {
  animationClipPoses,
  animationClipDefaults,
  animationIsComplete,
  buildStructuredPrompt,
  createActionStripAnimation,
  isStructuredPromptBlank,
  normalizeAnimationSpec,
} from '@/lib/asset-catalog'
import { cacheAssetUrl, cacheSpecAssets, hydrateSpecAssets, removeCachedAssetClips, stripLargeAssetUrls } from '@/lib/asset-db'
import { prepareAnimationReferenceImages } from '@/lib/animation-references'
import { ASSET_TYPES } from '@/types'
import { BUILTIN_ART, buildBuiltinGameSpec } from '@/lib/builtin-game'
import { DEFAULT_COMFY_SETTINGS, discoverComfyCheckpoints, generateComfyImage, type ComfySettings } from '@/lib/comfyui-client'
import { readUploadedImage, repeatImageAsStrip, withUploadedClip, withUploadedStatic } from '@/lib/uploaded-asset'
import { IMAGE_PROVIDERS } from '@/configs/image-providers'
import { customConnectionError, EMPTY_CUSTOM_CONNECTION, loadAiAccessMode, loadCustomConnection, saveAiAccessMode, saveCustomConnection, type AiAccessMode, type CustomConnection } from '@/lib/custom-connection'
import AiAccessTabs from './ui/AiAccessTabs'
import CustomConnectionFields from './ui/CustomConnectionFields'
import AiProviderChoice from './ui/AiProviderChoice'
import StageHeading from './ui/StageHeading'
import InspirationLibrary, { type InspirationTarget } from './ui/InspirationLibrary'
import ThemesList from './ThemesList'
import { getApiPlatformGuide } from '@/configs/api-platform-guide'
import { mergeProjectBrief } from '@/lib/project-brief'
import { preserveExplicitPromptFields, serializeGameSpec } from '@/lib/game-spec'
import { isLocalAgentProvider } from '@/lib/agents/config'
import { executeLocalAgentTask } from '@/lib/agents/local-client'
import { createWebLlmCreativePatch, isWebLlmReady } from '@/lib/agents/webllm-client'
import { applyWebLlmCreativePatch } from '@/lib/agents/webllm-lite'
import { selectedInspirationTexts } from '@/configs/inspiration-packs'
import type {
  AnimationClipPose,
  AgentExecuteRequest,
  AgentExecuteResponse,
  AgentProviderId,
  AssetDefinition,
  GameData,
  GameSpec,
  GameTheme,
  GenerateImageRequest,
  ProviderId,
  RegeneratingImages,
  Theme,
} from '@/types'

export interface SideMenuProps {
  apiKey: string
  onApiKeyChange: (apiKey: string) => void
  selectedProvider: ProviderId
  onProviderChange: (provider: ProviderId) => void
  selectedModel: string
  onModelChange: (model: string) => void
  onStartGame?: () => void
  onCreateTheme?: () => void
  onThemeUpdate?: (themes: Theme[]) => void
  generateImages?: (requestBody: GenerateImageRequest) => Promise<GameData>
  onRegeneratingImagesChange?: (state: RegeneratingImages) => void
  themesListRef?: React.RefObject<HTMLDivElement | null>
  className?: string
  style?: React.CSSProperties
  onImageSourceChange?: (source: 'builtin' | 'upload' | 'comfy' | 'byok' | 'custom') => void
  onCustomImageChange?: (connection: CustomConnection) => void
  onComfySettingsChange?: (settings: ComfySettings) => void
  themes: Theme[]
  onThemeSelect: (themeId: GameTheme) => void
  activeStage: 'idea' | 'agents' | 'assets'
  onStageChange: (stage: 'idea' | 'agents' | 'assets') => void
  workspaceTarget: HTMLDivElement | null
}

const EMPTY_GENERATING = Object.fromEntries(ASSET_TYPES.map((type) => [type, false])) as RegeneratingImages
const ALL_GENERATING = Object.fromEntries(ASSET_TYPES.map((type) => [type, true])) as RegeneratingImages
const DRAFT_KEY = 'pixel-world-v3-generation-draft'
const DRAFT_PROJECT_ID = 'active-draft'

interface SavedDraft {
  name?: string
  story?: string
  spec: GameSpec
  prompt?: string
  sourcePrompt?: string
}

interface GenerationTarget {
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl?: string
}

function composeProjectPrompt(name: string, story: string, prompt: string, levels: number): string {
  const base = prompt.trim() || buildStructuredPrompt(levels)
  return mergeProjectBrief(base, name, story)
}

function patchSpecAsset(spec: GameSpec, id: string, patch: Partial<AssetDefinition>): GameSpec {
  return { ...spec, assets: spec.assets.map((asset) => asset.id === id ? { ...asset, ...patch } : asset) }
}

const SideMenu: React.FC<SideMenuProps> = ({
  apiKey,
  onApiKeyChange,
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
  onStartGame,
  onCreateTheme,
  onThemeUpdate,
  onRegeneratingImagesChange,
  themesListRef,
  className,
  style,
  onImageSourceChange,
  onCustomImageChange,
  onComfySettingsChange,
  themes,
  onThemeSelect,
  activeStage,
  onStageChange,
  workspaceTarget,
}) => {
  const {
    selectedTheme, customPrompt, levelCount, setSelectedTheme, setCustomPrompt, setLevelCount,
    setGameState, setLoadingMessage, setGameData, isLoading, setLoading,
  } = useGameStore()
  const [customThemeName, setCustomThemeName] = useState('')
  const [customStory, setCustomStory] = useState('')
  const [isThemeCreated, setIsThemeCreated] = useState(false)
  const [optimizedSpec, setOptimizedSpec] = useState<GameSpec | null>(null)
  const [creationMode, setCreationMode] = useState<'agent' | 'classic'>('agent')
  const [imageSource, setImageSource] = useState<'builtin' | 'upload' | 'comfy' | 'byok' | 'custom'>('builtin')
  const [imageAccessMode, setImageAccessMode] = useState<AiAccessMode>('ready')
  const [readyImageSource, setReadyImageSource] = useState<'builtin' | 'upload' | 'comfy'>('builtin')
  const [ownImageSource, setOwnImageSource] = useState<'byok' | 'custom'>('byok')
  const [customImage, setCustomImage] = useState<CustomConnection>(EMPTY_CUSTOM_CONNECTION)
  const [comfyEndpoint, setComfyEndpoint] = useState(DEFAULT_COMFY_SETTINGS.endpoint)
  const [comfyCheckpoint, setComfyCheckpoint] = useState('')
  const [comfyCheckpoints, setComfyCheckpoints] = useState<string[]>([])
  const [comfyDetecting, setComfyDetecting] = useState(false)
  const [agentApproved, setAgentApproved] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [textOptimizer, setTextOptimizer] = useState<{ provider?: AgentProviderId; model?: string; apiKey: string; baseUrl?: string }>({ apiKey: '' })
  const [generationProgress, setGenerationProgress] = useState(0)
  const [isTesting, setIsTesting] = useState(false)
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const optimizedInputRef = useRef<{ source: string; generated: string } | null>(null)
  const briefRevisionRef = useRef(0)
  const [inputRevision, setInputRevision] = useState(0)
  const [agentReviewTarget, setAgentReviewTarget] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    const mode = loadAiAccessMode('image')
    const ready = localStorage.getItem('pixel-world-image-ready-choice')
    const own = localStorage.getItem('pixel-world-image-own-choice')
    const readyChoice = ready === 'comfy' || ready === 'upload' ? ready : 'builtin'
    const ownChoice = own === 'custom' ? 'custom' : 'byok'
    setReadyImageSource(readyChoice)
    setOwnImageSource(ownChoice)
    setImageAccessMode(mode)
    setImageSource(mode === 'own' ? ownChoice : readyChoice)
    setCustomImage(loadCustomConnection('image'))
  }, [])

  const changeImageAccessMode = (mode: AiAccessMode) => {
    setImageAccessMode(mode)
    saveAiAccessMode('image', mode)
    setImageSource(mode === 'ready' ? readyImageSource : ownImageSource)
  }

  const changeCustomImage = (value: CustomConnection) => {
    setCustomImage(value)
    saveCustomConnection('image', value)
    onCustomImageChange?.(value)
  }

  useEffect(() => { onCustomImageChange?.(customImage) }, [customImage, onCustomImageChange])

  useEffect(() => { onImageSourceChange?.(imageSource) }, [imageSource, onImageSourceChange])
  useEffect(() => { onComfySettingsChange?.({ endpoint: comfyEndpoint, checkpoint: comfyCheckpoint }) }, [comfyEndpoint, comfyCheckpoint, onComfySettingsChange])

  useEffect(() => {
    // Opening the creator always starts from an empty field skeleton. A previous
    // generation draft stays available, but it must never overwrite a new idea.
    setCustomPrompt(buildStructuredPrompt(levelCount))
    setCustomThemeName('')
    setCustomStory('')
    setOptimizedSpec(null)
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw) as SavedDraft
        if (draft.spec?.version === 3) setSavedDraft(draft)
      }
    } catch {
      // Ignore malformed drafts.
    }
  }, [])

  const restoreSavedDraft = () => {
    if (!savedDraft) return
    briefRevisionRef.current += 1
    setInputRevision((revision) => revision + 1)
    const restoredPrompt = savedDraft.prompt?.trim() || buildStructuredPrompt(savedDraft.spec.levels.length)
    optimizedInputRef.current = savedDraft.sourcePrompt && savedDraft.sourcePrompt !== restoredPrompt
      ? { source: savedDraft.sourcePrompt, generated: restoredPrompt }
      : null
    setCustomThemeName(savedDraft.name || savedDraft.spec.title)
    setCustomStory(savedDraft.story || savedDraft.spec.backgroundStory || '')
    setCustomPrompt(restoredPrompt)
    setLevelCount(savedDraft.spec.levels.length)
    setOptimizedSpec(savedDraft.spec)
    setAgentApproved(false)
    void hydrateSpecAssets(DRAFT_PROJECT_ID, savedDraft.spec).then((hydrated) => setOptimizedSpec(hydrated))
    setSavedDraft(null)
    message.success('已恢复上次素材规划；新建页面默认仍保持空白字段。')
  }

  const persistDraft = (spec: GameSpec, prompt = customPrompt) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: customThemeName, story: customStory, prompt, sourcePrompt: optimizedInputRef.current?.source, spec: stripLargeAssetUrls(spec) }))
    } catch {
      // Large image URLs are also cached by IndexedDB; draft failure must not interrupt generation.
    }
  }

  const updateSpec = (spec: GameSpec, prompt?: string) => {
    setOptimizedSpec(spec)
    persistDraft(spec, prompt)
  }

  const resetGeneratedPromptOnBriefEdit = () => {
    const previous = optimizedInputRef.current
    if (previous && customPrompt === previous.generated) setCustomPrompt(previous.source)
    optimizedInputRef.current = null
  }

  const applyInspiration = (target: InspirationTarget, text: string) => {
    if (target === 'story' && customStory.includes(text)) return void message.info('这条灵感已在故事中。')
    briefRevisionRef.current += 1
    setInputRevision((revision) => revision + 1)
    const sourcePrompt = customPrompt === optimizedInputRef.current?.generated
      ? optimizedInputRef.current.source
      : customPrompt
    optimizedInputRef.current = null
    setOptimizedSpec(null)
    setAgentApproved(false)
    if (target === 'story') {
      setCustomStory((story) => `${story.trim()}${story.trim() ? '\n' : ''}【已选灵感】${text}。`)
    } else {
      const styleLine = /^整体像素风格：[^\n]*/m
      const currentStyle = sourcePrompt.match(styleLine)?.[0]?.replace(/^整体像素风格：/, '').trim()
      const nextStyle = currentStyle ? `${currentStyle}；${text}` : text
      setCustomPrompt(styleLine.test(sourcePrompt)
        ? sourcePrompt.replace(styleLine, `整体像素风格：${nextStyle}`)
        : `整体像素风格：${nextStyle}\n${sourcePrompt}`)
    }
    message.success('已加入构想，你可以继续修改。')
  }

  const uploadDraftAsset = async (assetId: string, file: File, pose?: AnimationClipPose) => {
    if (!optimizedSpec) throw new Error('请先建立素材规划。')
    const asset = optimizedSpec.assets.find((item) => item.id === assetId)
    if (!asset) throw new Error('未找到该素材。')
    const frames = pose ? normalizeAnimationSpec(asset.animation).clips?.[pose]?.frameCount || animationClipDefaults(pose).frameCount : 1
    const url = await readUploadedImage(file, frames, Boolean(pose))
    const nextAsset = pose ? withUploadedClip(asset, pose, url) : withUploadedStatic(asset, url)
    if (pose) {
      await cacheAssetUrl(DRAFT_PROJECT_ID, `${assetId}:clip:${pose}`, url)
      if (pose === 'idle') await cacheAssetUrl(DRAFT_PROJECT_ID, assetId, url)
    } else {
      await removeCachedAssetClips(DRAFT_PROJECT_ID, assetId)
      await cacheAssetUrl(DRAFT_PROJECT_ID, assetId, url)
    }
    updateSpec(patchSpecAsset(optimizedSpec, assetId, nextAsset))
  }

  const fillMissingWithBuiltin = async () => {
    if (!optimizedSpec) return
    const builtIn = buildBuiltinGameSpec(optimizedSpec, `${customThemeName} ${customStory}`)
    const assets: AssetDefinition[] = []
    for (let index = 0; index < optimizedSpec.assets.length; index += 1) {
      const asset = optimizedSpec.assets[index]
      if (!asset.enabled || (asset.kind !== 'image' && asset.kind !== 'spriteSheet')) { assets.push(asset); continue }
      if (asset.kind === 'image') {
        const filled = asset.url ? asset : builtIn.assets[index]
        if (filled.url && !asset.url) await cacheAssetUrl(DRAFT_PROJECT_ID, asset.id, filled.url)
        assets.push(filled)
        continue
      }
      const animation = normalizeAnimationSpec(asset.animation)
      const poses = animationClipPoses(asset)
      const missing = poses.filter((pose) => !animation.clips?.[pose]?.url)
      if (!missing.length) { assets.push(asset); continue }
      const fallback = animation.clips?.idle?.url || BUILTIN_ART[asset.category]
      if (!fallback) { assets.push(asset); continue }
      let filled = asset
      for (const pose of missing) {
        const frames = animation.clips?.[pose]?.frameCount || 1
        const strip = await repeatImageAsStrip(fallback, frames)
        filled = withUploadedClip(filled, pose, strip)
        await cacheAssetUrl(DRAFT_PROJECT_ID, `${asset.id}:clip:${pose}`, strip)
        if (pose === 'idle') await cacheAssetUrl(DRAFT_PROJECT_ID, asset.id, strip)
      }
      assets.push(filled)
    }
    updateSpec({ ...optimizedSpec, assets })
    message.success('已用内置图片补齐缺项，上传素材保持不变。')
  }

  const optimizePrompt = async (quiet = false, promptOverride?: string, themeOverride?: string): Promise<GameSpec | null> => {
    const projectName = themeOverride?.trim() || customThemeName.trim()
    const story = customStory.trim()
    if (!projectName || !story) {
      if (!quiet) message.warning('请先填写游戏名称和故事，再补全游戏设定。')
      return null
    }
    const revision = briefRevisionRef.current
    const currentPrompt = promptOverride ?? customPrompt
    const rawPrompt = (currentPrompt === optimizedInputRef.current?.generated
      ? optimizedInputRef.current.source
      : currentPrompt).trim()
    const prompt = rawPrompt || buildStructuredPrompt(levelCount)
    setIsOptimizing(true)
    try {
      const response = await fetch('/api/optimize-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, story, theme: projectName, levelCount }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || '提示词优化失败。')
      let spec = result.data.spec as GameSpec
      let usedModel = false
      let modelWarning = ''
      const connection = textOptimizer
      if (connection.provider && connection.model) {
        const sourceBrief = mergeProjectBrief(prompt, projectName, story)
        if (connection.provider === 'webllm') {
          if (!isWebLlmReady(connection.model)) {
            modelWarning = 'WebLLM 尚未准备完成，已使用稳定的本地草案。先在文字策划中准备浏览器模型，再进行轻量灵感补全。'
          } else {
            try {
              const patch = await createWebLlmCreativePatch(connection.model, projectName, story, selectedInspirationTexts(sourceBrief))
              spec = preserveExplicitPromptFields(applyWebLlmCreativePatch(spec, patch), spec, sourceBrief)
              usedModel = true
              modelWarning = 'WebLLM 已补充世界、主角与画风方向；关卡和素材规格由本地规则稳定生成。'
            } catch (error) {
              modelWarning = `WebLLM 轻量补全失败，已使用本地草案：${error instanceof Error ? error.message : '未知错误'}`
            }
          }
        } else if (!isLocalAgentProvider(connection.provider) && !connection.apiKey.trim()) {
          modelWarning = '文字服务缺少 API Key，已使用本地草案。'
        } else {
          try {
            const task: AgentExecuteRequest = {
              runId: `prompt-optimize-${Date.now()}`,
              taskId: 'prompt-integrator',
              role: 'integrator',
              round: 1,
              provider: connection.provider,
              model: connection.model,
              apiKey: connection.apiKey.trim(),
              baseUrl: connection.baseUrl,
              sourcePrompt: sourceBrief,
              projectName,
              levelCount,
              baseSpec: spec,
              artifacts: {},
            }
            const agentResult: AgentExecuteResponse = isLocalAgentProvider(connection.provider)
              ? await executeLocalAgentTask(task)
              : await fetch('/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task) })
                .then((reply) => reply.json() as Promise<AgentExecuteResponse>)
            const candidate = agentResult.data?.artifact.spec as GameSpec | undefined
            if (!agentResult.success || !candidate) throw new Error(agentResult.error || '模型没有返回可用的游戏规格。')
            if (agentResult.data?.artifact.localFallback) {
              modelWarning = '文字模型暂时不可用，已使用本地草案。'
            } else {
              spec = candidate
              usedModel = true
            }
          } catch (error) {
            modelWarning = `文字模型补全失败，已使用本地草案：${error instanceof Error ? error.message : '未知错误'}`
          }
        }
      }
      if (revision !== briefRevisionRef.current) {
        if (!quiet) message.info('填写内容已变化；请基于最新的名称和故事重新补全。')
        return null
      }
      const generatedPrompt = serializeGameSpec(spec)
      optimizedInputRef.current = { source: rawPrompt, generated: generatedPrompt }
      updateSpec(spec, generatedPrompt)
      setCustomPrompt(generatedPrompt)
      if (!quiet && activeStage === 'idea') onStageChange(creationMode === 'classic' ? 'assets' : 'agents')
      if (!quiet) {
        message.success(usedModel
          ? '所选文字模型已围绕名称和故事补全游戏设定。'
          : result.data.source === 'template'
            ? '完整模板已转换为稳定的 V3 素材规划。'
            : '已根据名称和故事整理本地草案；请检查主角与关卡，文字 Agent 可继续细化。')
        if (modelWarning) message.warning(modelWarning, 6)
      }
      return spec
    } catch (error) {
      if (!quiet) message.error(error instanceof Error ? error.message : '提示词优化失败。')
      return null
    } finally {
      setIsOptimizing(false)
    }
  }

  const requestAsset = async (
    spec: GameSpec,
    asset: AssetDefinition,
    signal?: AbortSignal,
    animationPose?: AnimationClipPose,
    target: GenerationTarget = imageSource === 'custom'
      ? { provider: 'custom', model: customImage.model.trim(), apiKey: customImage.apiKey.trim(), baseUrl: customImage.baseUrl.trim() }
      : { provider: selectedProvider, model: selectedModel, apiKey: apiKey.trim() },
  ): Promise<AssetDefinition> => {
    if (imageSource === 'comfy') {
      if (asset.kind === 'spriteSheet') throw new Error('ComfyUI 简化工作流仅生成单张图片；角色动作使用内置素材。')
      const url = await generateComfyImage({ endpoint: comfyEndpoint, checkpoint: comfyCheckpoint }, asset.prompt, signal)
      return { ...asset, kind: 'image', url, status: 'success', error: undefined }
    }
    const firstLevelId = asset.levelIds[0]
    const levelIndex = Math.max(0, spec.levels.findIndex((level) => level.id === firstLevelId))
    const referenceImages = animationPose
      ? await prepareAnimationReferenceImages(spec, asset, animationPose)
      : []
    const response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        theme: spec.title,
        prompt: asset.prompt,
        provider: target.provider, model: target.model, apiKey: target.apiKey, customBaseUrl: target.baseUrl,
        levelCount: spec.levels.length,
        spec: stripLargeAssetUrls(spec),
        asset: stripLargeAssetUrls({ ...spec, assets: [asset] }).assets[0],
        levelIndex,
        animationPose,
        referenceImages,
      }),
    })
    const result = await response.json().catch(() => null)
    const generatedAsset = result?.data?.asset as AssetDefinition | undefined
    const generatedClip = animationPose ? normalizeAnimationSpec(generatedAsset?.animation).clips?.[animationPose] : undefined
    if (!response.ok || !result?.success || (!animationPose && !generatedAsset?.url) || (animationPose && !generatedClip?.url)) {
      throw new Error(formatGenerationError(result?.error || `HTTP ${response.status}`))
    }
    if (!generatedAsset) throw new Error('The image API returned no asset data.')
    if (!animationPose) return generatedAsset
    const currentAnimation = asset.animation?.layoutVersion === 3
      ? normalizeAnimationSpec(asset.animation)
      : createActionStripAnimation()
    const mergedAsset: AssetDefinition = {
      ...asset,
      ...generatedAsset,
      animation: {
        ...currentAnimation,
        clips: { ...currentAnimation.clips, [animationPose]: generatedClip },
      },
      url: animationPose === 'idle' ? generatedClip?.url : asset.url,
      error: undefined,
    }
    return { ...mergedAsset, status: animationIsComplete(mergedAsset) ? 'success' : 'pending' }
  }

  const testApi = async () => {
    if (imageSource === 'custom') {
      const issue = customConnectionError(customImage)
      if (issue) return void message.error(issue)
      setIsTesting(true)
      try {
        const response = await fetch('/api/custom-connection/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: customImage.baseUrl.trim(), model: customImage.model.trim(), apiKey: customImage.apiKey.trim() }) })
        const result = await response.json().catch(() => null)
        if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
        message.success('图片接口已返回有效测试图片。')
      } catch (error) { message.error(error instanceof Error ? error.message : '图片接口测试失败。') }
      finally { setIsTesting(false) }
      return
    }
    if (imageSource === 'builtin' || imageSource === 'upload') return void message.info('此方案无需连接图片 API。')
    if (imageSource === 'comfy') {
      setComfyDetecting(true)
      try { const models = await discoverComfyCheckpoints(comfyEndpoint); setComfyCheckpoints(models); if (models.length && !models.includes(comfyCheckpoint)) setComfyCheckpoint(models[0]); message.success(`检测到 ${models.length} 个 ComfyUI 检查点。`) }
      catch (error) { message.error(error instanceof Error ? error.message : 'ComfyUI 连接失败。') }
      finally { setComfyDetecting(false) }
      return
    }
    if (!apiKey.trim()) return void message.error('请先填写 API Key。')
    let spec = optimizedSpec
    if (!spec) spec = await optimizePrompt(true)
    if (!spec) return
    const source = spec.assets.find((asset) => asset.category === 'collectible')
    if (!source) return void message.error('当前规格没有可用于测试的收集品素材。')
    setIsTesting(true)
    try {
      await requestAsset(spec, { ...source, id: `api-test-${Date.now()}`, title: 'API Test', prompt: 'One tiny luminous pixel crystal pickup for API validation.' })
      message.success('API 测试成功：模型已经返回有效图片。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'API 测试失败。')
    } finally {
      setIsTesting(false)
    }
  }

  const generateSelectedAssets = async () => {
    if (creationMode === 'agent' && !agentApproved) return void message.error('请先完成 Agent 集群评审，并点击“批准规格并开放生图”。')
    if (imageSource === 'builtin') return createBuiltinGame()
    if (imageSource === 'upload') return void message.info('请在素材卡片逐项上传图片，或主动用内置素材补齐。')
    if (imageSource === 'byok' && !apiKey.trim()) return void message.error('图片生成需要 API Key。')
    if (imageSource === 'custom') { const issue = customConnectionError(customImage); if (issue) return void message.error(issue) }
    let baseSpec = optimizedSpec
    if (!baseSpec || baseSpec.levels.length !== levelCount) baseSpec = await optimizePrompt(true)
    if (!baseSpec) return void message.error('请先点击“一键优化提示词”建立 V3 素材规划。')
    if (imageSource === 'comfy') {
      if (!comfyCheckpoint) return void message.error('请先检测并选择 ComfyUI 检查点。')
      const builtIn = buildBuiltinGameSpec(baseSpec)
      baseSpec = { ...baseSpec, assets: baseSpec.assets.map((asset, index) => asset.kind === 'spriteSheet' ? builtIn.assets[index] : asset) }
    }
    const tasks = baseSpec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet') && (
      asset.kind === 'spriteSheet'
        ? !animationIsComplete(asset)
        : !asset.url || asset.status === 'failed' || asset.status === 'cancelled'
    ))
    if (!tasks.length) return void message.info('所有已启用图片素材都已生成。')
    const generationTarget: GenerationTarget = {
      provider: imageSource === 'custom' ? 'custom' : selectedProvider,
      model: imageSource === 'custom' ? customImage.model.trim() : selectedModel,
      apiKey: imageSource === 'custom' ? customImage.apiKey.trim() : apiKey.trim(),
      baseUrl: imageSource === 'custom' ? customImage.baseUrl.trim() : undefined,
    }
    const providerConcurrency: Partial<Record<ProviderId, number>> = {
      cloudflare: 4,
      together: 4,
      pollinations: 4,
      tencent: 3,
      huggingface: 2,
      openrouter: 2,
      openai: 2,
      dashscope: 2,
    }
    const concurrency = imageSource === 'comfy' ? 1 : providerConcurrency[generationTarget.provider] || 2

    const pendingPoses = (asset: AssetDefinition): AnimationClipPose[] => {
      if (asset.kind !== 'spriteSheet') return []
      const animation = normalizeAnimationSpec(asset.animation)
      if (animation.layoutVersion !== 3 || !animation.clips) return []
      return animationClipPoses(asset).filter((pose) => {
        const clip = animation.clips?.[pose]
        return !clip?.url || clip.status === 'failed' || clip.status === 'cancelled'
      })
    }
    const totalJobs = tasks.reduce((sum, asset) => sum + (asset.kind === 'spriteSheet' ? pendingPoses(asset).length : 1), 0)

    const loadingId = `loading-${Date.now()}` as GameTheme
    const loadingTheme: Theme = { id: loadingId, name: baseSpec.title, description: customPrompt, characterImage: '', backgroundImage: '', groundImage: '', obstacleImage: '', spec: baseSpec, isLoading: true }
    const themesWithLoading = [...themes.filter((theme) => !theme.isLoading), loadingTheme]
    const controller = new AbortController()
    abortRef.current = controller
    const results = new Map<string, AssetDefinition>()
    const workingAssets = new Map(baseSpec.assets.map((asset) => [asset.id, asset]))
    let finished = 0

    const updateAsset = (id: string, patch: Partial<AssetDefinition>) => {
      const working = workingAssets.get(id)
      if (working) workingAssets.set(id, { ...working, ...patch })
      setOptimizedSpec((current) => {
        if (!current) return current
        const next = patchSpecAsset(current, id, patch)
        persistDraft(next)
        return next
      })
    }

    try {
      setLoading(true)
      setGenerationProgress(0)
      setLoadingMessage(`正在使用 ${imageSource === 'comfy' ? '本机 ComfyUI' : generationTarget.model} 生成 ${totalJobs} 个任务。`)
      setGameState('loading')
      onRegeneratingImagesChange?.(ALL_GENERATING)
      setSelectedTheme(loadingId)
      onThemeUpdate?.(themesWithLoading)

      const runPhase = async (phaseTasks: AssetDefinition[]) => {
        let cursor = 0
        const worker = async () => {
        while (!controller.signal.aborted) {
          const taskIndex = cursor++
          if (taskIndex >= phaseTasks.length) return
          const asset = phaseTasks[taskIndex]
          let currentAsset: AssetDefinition = asset.kind === 'spriteSheet' && asset.animation?.layoutVersion !== 3
            ? { ...asset, url: undefined, animation: createActionStripAnimation(), status: 'pending' }
            : asset
          updateAsset(asset.id, { ...currentAsset, status: 'generating', error: undefined })
          try {
            if (currentAsset.kind === 'spriteSheet') {
              const poses = pendingPoses(currentAsset)
              for (const pose of poses) {
                if (controller.signal.aborted) break
                const animation = normalizeAnimationSpec(currentAsset.animation)
                currentAsset = {
                  ...currentAsset,
                  status: 'generating',
                  animation: {
                    ...animation,
                    clips: {
                      ...animation.clips,
                      [pose]: { ...animation.clips?.[pose]!, status: 'generating', error: undefined },
                    },
                  },
                }
                updateAsset(asset.id, currentAsset)
                try {
                  const liveSpec = { ...baseSpec!, assets: baseSpec!.assets.map((candidate) => workingAssets.get(candidate.id) || candidate) }
                  currentAsset = await requestAsset(liveSpec, currentAsset, controller.signal, pose, generationTarget)
                  const clip = normalizeAnimationSpec(currentAsset.animation).clips?.[pose]
                  if (clip?.url) {
                    await cacheAssetUrl(DRAFT_PROJECT_ID, `${asset.id}:clip:${pose}`, clip.url)
                    if (pose === 'idle') await cacheAssetUrl(DRAFT_PROJECT_ID, asset.id, clip.url)
                  }
                  updateAsset(asset.id, currentAsset)
                } catch (error) {
                  const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
                  const clipError = cancelled ? 'Generation cancelled.' : error instanceof Error ? error.message : 'Generation failed.'
                  const failedAnimation = normalizeAnimationSpec(currentAsset.animation)
                  currentAsset = {
                    ...currentAsset,
                    status: cancelled ? 'cancelled' : 'failed',
                    error: clipError,
                    animation: {
                      ...failedAnimation,
                      clips: {
                        ...failedAnimation.clips,
                        [pose]: { ...failedAnimation.clips?.[pose]!, status: cancelled ? 'cancelled' : 'failed', error: clipError },
                      },
                    },
                  }
                  updateAsset(asset.id, currentAsset)
                } finally {
                  finished += 1
                  setGenerationProgress(Math.round(finished / Math.max(1, totalJobs) * 100))
                  setLoadingMessage(`动作与素材生成进度 ${finished}/${totalJobs}`)
                }
              }
              currentAsset = { ...currentAsset, status: animationIsComplete(currentAsset) ? 'success' : currentAsset.status }
            } else {
              const liveSpec = { ...baseSpec!, assets: baseSpec!.assets.map((candidate) => workingAssets.get(candidate.id) || candidate) }
              const generated = await requestAsset(liveSpec, currentAsset, controller.signal, undefined, generationTarget)
              currentAsset = { ...currentAsset, ...generated, status: 'success', error: undefined }
              if (currentAsset.url) await cacheAssetUrl(DRAFT_PROJECT_ID, currentAsset.id, currentAsset.url)
              finished += 1
              setGenerationProgress(Math.round(finished / Math.max(1, totalJobs) * 100))
              setLoadingMessage(`动作与素材生成进度 ${finished}/${totalJobs}`)
            }
            results.set(asset.id, currentAsset)
            workingAssets.set(asset.id, currentAsset)
            updateAsset(asset.id, currentAsset)
          } catch (error) {
            const cancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
            const failedAsset = { ...currentAsset, status: cancelled ? 'cancelled' as const : 'failed' as const, error: cancelled ? 'Generation cancelled.' : error instanceof Error ? error.message : 'Generation failed.' }
            results.set(asset.id, failedAsset)
            workingAssets.set(asset.id, failedAsset)
            updateAsset(asset.id, failedAsset)
            if (currentAsset.kind !== 'spriteSheet') {
              finished += 1
              setGenerationProgress(Math.round(finished / Math.max(1, totalJobs) * 100))
              setLoadingMessage(`动作与素材生成进度 ${finished}/${totalJobs}`)
            }
          }
        }
      }
        await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, phaseTasks.length)) }, () => worker()))
      }

      // Weapons, projectiles and effects must exist before attack strips are
      // generated so those exact project assets can be supplied as references.
      await runPhase(tasks.filter((asset) => asset.kind !== 'spriteSheet'))
      await runPhase(tasks.filter((asset) => asset.kind === 'spriteSheet'))

      const finalAssets = baseSpec.assets.map((asset) => results.get(asset.id) || asset)
      const finalSpec = { ...baseSpec, assets: finalAssets }
      const gameData = buildGameDataFromSpec(finalSpec)
      const firstLevel = gameData.data?.levels[0]
      const finalId = `custom-${Date.now()}` as GameTheme
      await cacheSpecAssets(finalId, finalSpec)
      setGameData(gameData, finalId)
      useGameStore.getState().removeGameDataForTheme(loadingId)
      const finalTheme: Theme = {
        id: finalId, name: finalSpec.title, description: customPrompt,
        characterImage: gameData.data?.characterUrl || '', backgroundImage: firstLevel?.backgroundUrl || '',
        groundImage: firstLevel?.groundUrl || '', obstacleImage: firstLevel?.obstacleUrl || '',
        enemyImage: gameData.data?.enemyUrl || '', weaponImage: gameData.data?.weaponUrl || '',
        projectileImage: gameData.data?.projectileUrl || '', attackEffectImage: gameData.data?.attackEffectUrl || '',
        collectibleImage: gameData.data?.collectibleUrl || '', bossImage: gameData.data?.bossUrl || '', spec: finalSpec,
      }
      const finalThemes = themesWithLoading.map((theme) => theme.id === loadingId ? finalTheme : theme)
      onThemeUpdate?.(finalThemes)
      setSelectedTheme(finalId)
      requestAnimationFrame(() => document.getElementById('preview-publish')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      setIsThemeCreated(true)
      setGameState('menu')
      updateSpec(finalSpec)
      const failures = finalAssets.filter((asset) => asset.status === 'failed').length
      if (failures) message.warning(`已保留成功素材；${failures} 个任务失败，可在素材卡片中重试。`)
      else if (controller.signal.aborted) message.info('生成已停止，已完成素材全部保留。')
      else message.success('已选择素材全部生成完成，可以开始游戏或导出。')
      onCreateTheme?.()
      setTimeout(() => { if (themesListRef?.current) themesListRef.current.scrollTop = themesListRef.current.scrollHeight }, 100)
    } finally {
      abortRef.current = null
      setLoading(false)
      onRegeneratingImagesChange?.(EMPTY_GENERATING)
    }
  }

  const publishPreparedGame = async (spec: GameSpec, successMessage: string) => {
    const gameData = buildGameDataFromSpec(spec)
    const firstLevel = gameData.data?.levels[0]
    const id = `custom-${Date.now()}` as GameTheme
    const theme: Theme = { id, name: spec.title, description: customPrompt,
      characterImage: gameData.data?.characterUrl || '', backgroundImage: firstLevel?.backgroundUrl || '',
      groundImage: firstLevel?.groundUrl || '', obstacleImage: firstLevel?.obstacleUrl || '',
      enemyImage: gameData.data?.enemyUrl || '', weaponImage: gameData.data?.weaponUrl || '',
      projectileImage: gameData.data?.projectileUrl || '', attackEffectImage: gameData.data?.attackEffectUrl || '',
      collectibleImage: gameData.data?.collectibleUrl || '', bossImage: gameData.data?.bossUrl || '', spec }
    await cacheSpecAssets(id, spec)
    const next = [...themes.filter((item) => !item.isLoading), theme]
    onThemeUpdate?.(next); setGameData(gameData, id); setSelectedTheme(id)
    requestAnimationFrame(() => document.getElementById('preview-publish')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    setGameState('menu'); setIsThemeCreated(true); updateSpec(spec); onCreateTheme?.()
    message.success(successMessage)
  }

  const createBuiltinGame = async () => {
    if (creationMode === 'agent' && !agentApproved) return void message.error('请先完成 Agent 集群评审，并点击“批准规格并开放生图”。')
    const base = optimizedSpec || await optimizePrompt(true)
    if (!base) return void message.error('游戏规格创建失败。')
    await publishPreparedGame(buildBuiltinGameSpec(base, `${customThemeName} ${customStory}`), '已使用内置像素素材创建可玩的游戏。')
  }

  const createUploadedGame = async () => {
    if (creationMode === 'agent' && !agentApproved) return void message.error('请先批准 Agent 游戏规格。')
    if (!optimizedSpec) return void message.error('请先建立游戏规格。')
    const missing = optimizedSpec.assets.flatMap((asset) => {
      if (!asset.enabled || (asset.kind !== 'image' && asset.kind !== 'spriteSheet')) return []
      if (asset.kind === 'image') return asset.url ? [] : [asset.title]
      const animation = normalizeAnimationSpec(asset.animation)
      return animationClipPoses(asset).filter((pose) => !animation.clips?.[pose]?.url).map((pose) => `${asset.title} · ${pose}`)
    })
    if (missing.length) return void message.error(`还缺 ${missing.slice(0, 3).join('、')}${missing.length > 3 ? ` 等 ${missing.length} 项` : ''}；可上传或点击“用内置素材补齐缺项”。`, 8)
    await publishPreparedGame(optimizedSpec, '已用上传素材创建可玩的游戏。')
  }

  const handleStartGame = () => {
    const state = useGameStore.getState()
    let activeTheme = state.selectedTheme
    let activeData = state.gameData
    if (isPresetTheme(activeTheme) || !activeData.data?.levels?.length) return void message.info('请先创建自己的游戏，再到右栏查看和试玩。')
    const synced = syncPlayableLevels(activeTheme, Math.max(2, state.levelCount), activeData)
    state.setGameData(synced.gameData, activeTheme)
    state.setTotalLevels(synced.totalLevels)
    state.setGameState('menu')
    state.saveToLocalStorage()
    onStartGame?.()
  }

  const storyReady = Boolean(customThemeName.trim() && customStory.trim())
  const planningReady = creationMode === 'agent' ? agentApproved : Boolean(optimizedSpec)

  return <>
    <div className={`${className || ''} creator-sidebar studio-control-rail`} style={{ padding: 16, height: 'auto', overflow: 'visible', ...style }}>
      <div className="studio-control-card">
        <nav className="studio-step-nav" aria-label="制作步骤">
          <div className="studio-step-nav-heading"><strong>制作进度</strong><span>选择步骤，查看当前要做的事</span></div>
          <button className={`studio-step-idea${activeStage === 'idea' ? ' is-active' : ''}${storyReady ? ' is-complete' : ''}`} aria-current={activeStage === 'idea' ? 'step' : undefined} onClick={() => onStageChange('idea')}><b>01</b><span>写故事<small>{storyReady ? '名称与故事已填写' : '填写名称与故事'}</small></span></button>
          <button className={`studio-step-agents${activeStage === 'agents' ? ' is-active' : ''}${planningReady ? ' is-complete' : ''}`} aria-current={activeStage === 'agents' ? 'step' : undefined} onClick={() => onStageChange('agents')}><b>02</b><span>AI 策划<small>{planningReady ? '规格已确认' : optimizedSpec ? '草案已建立' : '选择模型并补全'}</small></span></button>
          <button className={`studio-step-assets${activeStage === 'assets' ? ' is-active' : ''}${isThemeCreated ? ' is-complete' : ''}`} aria-current={activeStage === 'assets' ? 'step' : undefined} onClick={() => onStageChange('assets')}><b>03</b><span>做素材<small>{isThemeCreated ? '游戏已创建' : !planningReady ? '先完成策划' : '选择来源并制作'}</small></span></button>
        </nav>
        <div className={`studio-control-stage-intro studio-control-stage-${activeStage}`}>
          <span>第 {activeStage === 'idea' ? '1' : activeStage === 'agents' ? '2' : '3'} 步 · 当前操作</span>
          <h2>{activeStage === 'idea' ? '写故事' : activeStage === 'agents' ? 'AI 策划' : '做素材'}</h2>
          <p>{activeStage === 'idea' ? '先在中栏写下游戏名称与故事；完成后会进入策划。' : activeStage === 'agents' ? '在这里选择文字工具；策划与审核结果会显示在中栏。' : '在这里选择图片来源，再到中栏制作素材。'}</p>
        </div>
        {activeStage === 'idea' && <div className="studio-step-guidance">
          <strong>{storyReady ? '名称和故事已经写好' : '从你的故事开始'}</strong>
          <p>{storyReady ? '可以继续补充灵感，也可以进入 AI 策划。' : '中栏的名称和故事是后续 AI 策划与画面的依据。'}</p>
          <Button type="link" onClick={() => document.getElementById('game-idea')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>前往中栏填写与检查 →</Button>
        </div>}
        <section id="agent-studio" className="studio-control-content section-anchor" hidden={activeStage !== 'agents'}>
          {creationMode === 'agent' ? <div className="agent-studio-shell"><AgentStudio
            embedded
            projectId={DRAFT_PROJECT_ID}
            sourcePrompt={composeProjectPrompt(customThemeName, customStory, customPrompt, levelCount)}
            projectName={customThemeName}
            briefReady={Boolean(customThemeName.trim() && customStory.trim())}
            levelCount={levelCount}
            baseSpec={optimizedSpec}
            onOptimizePrompt={() => optimizePrompt(false)}
            isOptimizing={isOptimizing}
            onSpecReady={(spec) => { updateSpec(spec); setAgentApproved(false) }}
            onApproved={(spec) => { updateSpec(spec); setAgentApproved(true); onStageChange('assets'); message.success('Agent 规格已批准，现在可以检查素材卡片并开始生成。') }}
            onApprovedRestored={(spec) => { updateSpec(spec); setAgentApproved(true) }}
            onTextConnectionChange={setTextOptimizer}
            reviewTarget={activeStage === 'agents' ? agentReviewTarget : null}
            inputRevision={inputRevision}
          /></div> : <div className="nav-section-placeholder">
            <p>传统模式使用本地草案。切换到 Agent 集群后，可让多个 Agent 策划、评审并修正规格。</p>
            <Button onClick={() => { setCreationMode('agent'); setAgentApproved(false); onStageChange('agents') }}>启用 Agent 集群</Button>
          </div>}
        </section>
        <section id="image-lab" className="studio-control-content section-anchor" hidden={activeStage !== 'assets'}>
          {creationMode === 'agent' && !agentApproved ? <div className="stage-gate-note" role="status"><strong>先批准 GameSpec</strong><span>批准后可在这里选图片来源，中栏制作素材。</span></div> : <Space direction="vertical" style={{ width: '100%' }}>
            <AiAccessTabs value={imageAccessMode} onChange={changeImageAccessMode} kind="image" />
            {imageAccessMode === 'ready' ? <Select value={readyImageSource} onChange={(value: 'builtin' | 'upload' | 'comfy') => { setReadyImageSource(value); setImageSource(value); localStorage.setItem('pixel-world-image-ready-choice', value) }} style={{ width: '100%' }} options={[
              { value: 'builtin', label: <AiProviderChoice name="内置像素素材" note="打开即用" color="#338a70" /> },
              { value: 'upload', label: <AiProviderChoice name="上传自己的图片" note="免 Key" color="#e58a3b" /> },
              { value: 'comfy', label: <AiProviderChoice name="ComfyUI Desktop" note="本机生图" color="#9160d4" /> },
            ]} /> : <Select value={ownImageSource === 'custom' ? 'custom' : selectedProvider} onChange={(value: ProviderId) => { if (value === 'custom') { setOwnImageSource('custom'); setImageSource('custom'); localStorage.setItem('pixel-world-image-own-choice', 'custom') } else { onProviderChange(value); setOwnImageSource('byok'); setImageSource('byok'); localStorage.setItem('pixel-world-image-own-choice', 'byok') } }} style={{ width: '100%' }} options={[...IMAGE_PROVIDERS.map((provider) => ({ value: provider.id, label: <AiProviderChoice name={provider.labelZh || provider.label} note={getApiPlatformGuide(provider.id).strengths[0]} color={getApiPlatformGuide(provider.id).accent} /> })), { value: 'custom', label: <AiProviderChoice name="手动接入其他服务" note="自定义接口" color="#317d70" /> }]} />}
            {imageSource === 'upload' && <p className="ai-source-help">在中栏素材卡片逐项上传图片；角色也能按动作上传帧条。</p>}
            {imageSource === 'comfy' && <><Input value={comfyEndpoint} onChange={(event) => setComfyEndpoint(event.target.value)} placeholder="http://127.0.0.1:8188" /><Space wrap><Button loading={comfyDetecting} onClick={() => { void testApi() }}>检测 ComfyUI</Button><Select value={comfyCheckpoint || undefined} onChange={setComfyCheckpoint} placeholder="选择检查点模型" style={{ minWidth: 220 }} options={comfyCheckpoints.map((name) => ({ value: name, label: name }))} /></Space><Alert type="info" showIcon message={<span><a href="https://comfy.org/download" target="_blank" rel="noopener noreferrer">下载 ComfyUI Desktop ↗</a> · 浏览器直连本机；需启动服务并允许跨域访问。角色动作暂用内置素材。</span>} /></>}
            {imageSource === 'byok' && <ModelSelector hideProviderSelector selectedProvider={selectedProvider} onProviderChange={onProviderChange} selectedModel={selectedModel} onModelChange={onModelChange} apiKey={apiKey} onApiKeyChange={onApiKeyChange} />}
            {imageSource === 'custom' && <><CustomConnectionFields kind="image" value={customImage} onChange={changeCustomImage} /><Space wrap><Button loading={isTesting} onClick={() => { void testApi() }}>测试连接</Button><span className="ai-cost-hint">测试会实际生成一张小图，可能产生一次调用费用。</span></Space></>}
            <p className="ai-effect-note">内置素材打开即用；本机效果取决于设备与模型。连接自己的服务可选更多模型，也可能按量收费。</p>
          </Space>}
          {planningReady && <div className="studio-rail-actions">
            {imageSource === 'builtin' && <Button block size="large" disabled={creationMode === 'agent' && !agentApproved} onClick={() => { void createBuiltinGame() }}>用内置素材创建游戏</Button>}
            {imageSource === 'upload' && <Button block size="large" type="primary" disabled={creationMode === 'agent' && !agentApproved} onClick={() => { void createUploadedGame() }}>用已上传素材创建游戏</Button>}
            <ActionButtons isThemeCreated={isThemeCreated} isLoading={isLoading} selectedTheme={isPresetTheme(selectedTheme) ? '' : selectedTheme} customPrompt={customPrompt} customThemeName={customThemeName} apiKey={imageSource === 'custom' ? customImage.apiKey : apiKey} allowWithoutApiKey={imageSource !== 'byok' && imageSource !== 'custom'} showCreateButton={imageSource !== 'builtin' && imageSource !== 'upload'} onCreateTheme={() => { void generateSelectedAssets() }} onStartGame={handleStartGame} />
          </div>}
        </section>
      </div>
    </div>
    {workspaceTarget && createPortal(<div className="studio-workspace">
      {themes.some((theme) => theme.id.startsWith('custom-')) && <ThemesList ref={themesListRef} themes={themes.filter((theme) => theme.id.startsWith('custom-') || theme.id.startsWith('loading-'))} selectedTheme={selectedTheme} onThemeSelect={onThemeSelect} />}
      <header className="studio-workspace-header">
        <small>{activeStage === 'idea' ? '第 1 步 · 写故事' : activeStage === 'agents' ? '第 2 步 · AI 策划' : '第 3 步 · 做素材'}</small>
        <h2>{activeStage === 'idea' ? '先写游戏名称和故事' : activeStage === 'agents' ? '让 AI 完善游戏设定' : '为游戏准备画面'}</h2>
        <p>{activeStage === 'idea' ? '写清主角是谁、想完成什么。后面的 AI 策划和画面会以此为依据。' : activeStage === 'agents' ? '在左栏选文字工具，补全设定并查看评审；游戏内容由你最后确认。' : '在左栏选图片来源，在这里逐项生成或上传；右栏可以查看成品。'}</p>
      </header>
      {activeStage === 'idea' && <section id="game-idea" className="studio-section prompt-section section-anchor studio-workspace-editor">
        <StageHeading title="名称与故事" />
        <ThemeCustomizer
          inspiration={<InspirationLibrary story={customStory} prompt={customPrompt} onApply={applyInspiration} />}
          creationMode={creationMode}
          onCreationModeChange={(mode) => { setCreationMode(mode); setAgentApproved(false); setInputRevision((revision) => revision + 1) }}
          customThemeName={customThemeName} onThemeNameChange={(value) => { briefRevisionRef.current += 1; setInputRevision((revision) => revision + 1); resetGeneratedPromptOnBriefEdit(); setCustomThemeName(value); setOptimizedSpec(null); setAgentApproved(false) }}
          customStory={customStory} onStoryChange={(value) => { briefRevisionRef.current += 1; setInputRevision((revision) => revision + 1); resetGeneratedPromptOnBriefEdit(); setCustomStory(value); setOptimizedSpec(null); setAgentApproved(false) }}
          customPrompt={customPrompt} onPromptChange={(value) => { briefRevisionRef.current += 1; setInputRevision((revision) => revision + 1); optimizedInputRef.current = null; setCustomPrompt(value); setOptimizedSpec(null); setAgentApproved(false) }}
          levelCount={levelCount} onLevelCountChange={(count) => { briefRevisionRef.current += 1; setInputRevision((revision) => revision + 1); setLevelCount(count); setOptimizedSpec(null); setAgentApproved(false); if (isStructuredPromptBlank(customPrompt)) setCustomPrompt(buildStructuredPrompt(count)) }}
          onOptimizePrompt={() => { void optimizePrompt(false) }} isOptimizing={isOptimizing} optimizedSpec={optimizedSpec}
          onCompleteIdea={() => onStageChange('agents')}
          hasSavedDraft={Boolean(savedDraft)} onRestoreDraft={restoreSavedDraft}
        />
      </section>}
      {activeStage === 'agents' && <section className="studio-section studio-workspace-review section-anchor">
        <StageHeading title="AI 策划与审核" />
        <p>左栏选好文字工具后，AI 的策划过程和审核结果会显示在这里；最后由你决定是否采用。</p>
        <div ref={setAgentReviewTarget} className="agent-review-target" />
      </section>}
      {activeStage === 'assets' && <section id="asset-workshop" className="section-anchor studio-workspace-assets">
        {optimizedSpec && (creationMode === 'classic' || agentApproved)
          ? <AssetPlanner spec={optimizedSpec} onChange={updateSpec} onGenerate={() => { void generateSelectedAssets() }} onCancel={() => abortRef.current?.abort()} onTestApi={() => { void testApi() }} onUpload={uploadDraftAsset} onFillMissing={() => { void fillMissingWithBuiltin().catch((error: unknown) => message.error(error instanceof Error ? error.message : '内置素材补齐失败。')) }} imageSource={imageSource} isGenerating={isLoading} isTesting={isTesting} progress={generationProgress} />
          : <div className="studio-section nav-section-placeholder"><StageHeading title="图片和声音素材" /><p>{creationMode === 'agent' ? '先确认 AI 策划的游戏内容，接着就能在这里上传或生成素材。' : '先补全游戏设定，接着就能在这里上传或生成素材。'}</p></div>}
      </section>}
    </div>, workspaceTarget)}
  </>
}

export default SideMenu
