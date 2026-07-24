'use client'

import React, { useEffect, useRef, useState } from 'react'
import { message } from 'antd'
import { useGameStore } from '@/lib/store'
import { isPresetTheme } from '@/lib/theme-utils'
import { ActionButtons, AgentStudio, AssetPlanner, ModelSelector, ProjectHeader, ThemeCustomizer } from './ui/index'
import { PRESET_THEMES } from '@/configs'
import { buildGameDataFromSpec, syncPlayableLevels } from '@/lib/virtual-levels'
import { formatGenerationError } from '@/lib/format-generation-error'
import {
  animationClipPoses,
  animationIsComplete,
  buildStructuredPrompt,
  createActionStripAnimation,
  isStructuredPromptBlank,
  normalizeAnimationSpec,
} from '@/lib/asset-catalog'
import { cacheAssetUrl, cacheSpecAssets, hydrateSpecAssets, stripLargeAssetUrls } from '@/lib/asset-db'
import { prepareAnimationReferenceImages } from '@/lib/animation-references'
import { ASSET_TYPES } from '@/types'
import type {
  AnimationClipPose,
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
}

const EMPTY_GENERATING = Object.fromEntries(ASSET_TYPES.map((type) => [type, false])) as RegeneratingImages
const ALL_GENERATING = Object.fromEntries(ASSET_TYPES.map((type) => [type, true])) as RegeneratingImages
const DRAFT_KEY = 'pixel-world-v3-generation-draft'
const DRAFT_PROJECT_ID = 'active-draft'

interface SavedDraft {
  name?: string
  spec: GameSpec
  prompt?: string
}

interface GenerationTarget {
  provider: ProviderId
  model: string
  apiKey: string
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
}) => {
  const {
    selectedTheme, customPrompt, levelCount, setSelectedTheme, setCustomPrompt, setLevelCount,
    setGameState, setLoadingMessage, setGameData, isLoading, setLoading,
  } = useGameStore()
  const [customThemeName, setCustomThemeName] = useState('')
  const [isThemeCreated, setIsThemeCreated] = useState(false)
  const [presetThemes, setPresetThemes] = useState<Theme[]>([...PRESET_THEMES])
  const [optimizedSpec, setOptimizedSpec] = useState<GameSpec | null>(null)
  const [creationMode, setCreationMode] = useState<'agent' | 'classic'>('agent')
  const [agentApproved, setAgentApproved] = useState(false)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [isTesting, setIsTesting] = useState(false)
  const [savedDraft, setSavedDraft] = useState<SavedDraft | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Opening the creator always starts from an empty field skeleton. A previous
    // generation draft stays available, but it must never overwrite a new idea.
    setCustomPrompt(buildStructuredPrompt(levelCount))
    setCustomThemeName('')
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
    setCustomThemeName(savedDraft.name || savedDraft.spec.title)
    setCustomPrompt(savedDraft.prompt?.trim() || buildStructuredPrompt(savedDraft.spec.levels.length))
    setLevelCount(savedDraft.spec.levels.length)
    setOptimizedSpec(savedDraft.spec)
    setAgentApproved(false)
    void hydrateSpecAssets(DRAFT_PROJECT_ID, savedDraft.spec).then((hydrated) => setOptimizedSpec(hydrated))
    setSavedDraft(null)
    message.success('已恢复上次素材规划；新建页面默认仍保持空白字段。')
  }

  const persistDraft = (spec: GameSpec) => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name: customThemeName, prompt: customPrompt, spec: stripLargeAssetUrls(spec) }))
    } catch {
      // Large image URLs are also cached by IndexedDB; draft failure must not interrupt generation.
    }
  }

  const updateSpec = (spec: GameSpec) => {
    setOptimizedSpec(spec)
    persistDraft(spec)
  }

  const optimizePrompt = async (quiet = false, promptOverride?: string, themeOverride?: string): Promise<GameSpec | null> => {
    const prompt = (promptOverride ?? customPrompt).trim()
    if (!prompt) {
      if (!quiet) message.error('请先填写游戏构想。')
      return null
    }
    setIsOptimizing(true)
    try {
      const response = await fetch('/api/optimize-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, theme: themeOverride?.trim() || customThemeName.trim() || 'Pixel World', levelCount, provider: selectedProvider, apiKey: apiKey.trim() }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || '提示词优化失败。')
      const spec = result.data.spec as GameSpec
      updateSpec(spec)
      setCustomPrompt(result.data.optimizedPrompt)
      if (!quiet) {
        message.success(result.data.source === 'ai'
          ? 'AI 已补全 V3 游戏规格。'
          : result.data.source === 'template'
            ? '完整模板已转换为稳定的 V3 素材规划。'
            : '本地编译器已补全 V3 游戏规格。')
        if (result.data.warning) message.info(result.data.warning, 5)
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
    target: GenerationTarget = { provider: selectedProvider, model: selectedModel, apiKey: apiKey.trim() },
  ): Promise<AssetDefinition> => {
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
        provider: target.provider,
        model: target.model,
        apiKey: target.apiKey,
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
    if (!apiKey.trim()) return void message.error('图片生成需要 API Key。')
    let baseSpec = optimizedSpec
    if (!baseSpec || baseSpec.levels.length !== levelCount) baseSpec = await optimizePrompt(true)
    if (!baseSpec) return void message.error('请先点击“一键优化提示词”建立 V3 素材规划。')
    const tasks = baseSpec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet') && (
      asset.kind === 'spriteSheet'
        ? !animationIsComplete(asset)
        : !asset.url || asset.status === 'failed' || asset.status === 'cancelled'
    ))
    if (!tasks.length) return void message.info('所有已启用图片素材都已生成。')
    const generationTarget: GenerationTarget = {
      provider: selectedProvider,
      model: selectedModel,
      apiKey: apiKey.trim(),
    }

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
    const themesWithLoading = [...presetThemes, loadingTheme]
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
      setLoadingMessage(`正在使用 ${generationTarget.model} 生成全部 ${totalJobs} 个独立动作与素材；不会切换模型。`)
      setGameState('loading')
      onRegeneratingImagesChange?.(ALL_GENERATING)
      setPresetThemes(themesWithLoading)
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
        await Promise.all([worker(), worker()])
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
      setPresetThemes(finalThemes)
      onThemeUpdate?.(finalThemes)
      setSelectedTheme(finalId)
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

  const handleStartGame = () => {
    const state = useGameStore.getState()
    let activeTheme = state.selectedTheme
    let activeData = state.gameData
    if (!isPresetTheme(activeTheme) && !activeData.data?.levels?.length) {
      activeTheme = 'fantasy'
      state.setSelectedTheme(activeTheme)
      activeData = state.gameDataByTheme[activeTheme] || {}
      message.info('当前主题没有可玩数据，已切换到 Fantasy。')
    }
    const synced = syncPlayableLevels(activeTheme, Math.max(2, state.levelCount), activeData)
    state.setGameData(synced.gameData, activeTheme)
    state.setTotalLevels(synced.totalLevels)
    state.setCurrentLevelIndex(0)
    state.setGameState('playing')
    state.saveToLocalStorage()
    onStartGame?.()
  }

  return <div className={`${className || ''} creator-sidebar`} style={{ padding: 20, height: '100%', overflowY: 'auto', ...style }}>
    <div className="creator-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
      <ProjectHeader />
      <section className="studio-section api-section">
        <div className="section-kicker">IMAGE LAB · 图片生成引擎</div>
        <ModelSelector selectedProvider={selectedProvider} onProviderChange={onProviderChange} selectedModel={selectedModel} onModelChange={onModelChange} apiKey={apiKey} onApiKeyChange={onApiKeyChange} />
      </section>
      <section className="studio-section prompt-section">
        <div className="section-kicker">WORLD BUILDER · 世界编辑器</div>
        <ThemeCustomizer
        creationMode={creationMode}
        onCreationModeChange={(mode) => { setCreationMode(mode); setAgentApproved(false) }}
        customThemeName={customThemeName} onThemeNameChange={setCustomThemeName}
        customPrompt={customPrompt} onPromptChange={(value) => { setCustomPrompt(value); setOptimizedSpec(null); setAgentApproved(false) }}
        levelCount={levelCount} onLevelCountChange={(count) => {
          setLevelCount(count)
          setOptimizedSpec(null)
          setAgentApproved(false)
          if (isStructuredPromptBlank(customPrompt)) setCustomPrompt(buildStructuredPrompt(count))
        }}
        onOptimizePrompt={() => { void optimizePrompt(false) }} isOptimizing={isOptimizing} optimizedSpec={optimizedSpec}
        hasSavedDraft={Boolean(savedDraft)} onRestoreDraft={restoreSavedDraft}
        />
      </section>
      {creationMode === 'agent' && <div className="agent-studio-shell"><AgentStudio
        projectId={DRAFT_PROJECT_ID}
        sourcePrompt={customPrompt}
        projectName={customThemeName}
        levelCount={levelCount}
        baseSpec={optimizedSpec}
        onSpecReady={(spec) => { updateSpec(spec); setAgentApproved(false) }}
        onApproved={(spec) => { updateSpec(spec); setAgentApproved(true); message.success('Agent 规格已批准，现在可以检查素材卡片并开始生成。') }}
      /></div>}
      {optimizedSpec && (creationMode === 'classic' || agentApproved) && <AssetPlanner spec={optimizedSpec} onChange={updateSpec} onGenerate={() => { void generateSelectedAssets() }} onCancel={() => abortRef.current?.abort()} onTestApi={() => { void testApi() }} isGenerating={isLoading} isTesting={isTesting} progress={generationProgress} />}
      <ActionButtons isThemeCreated={isThemeCreated} isLoading={isLoading} selectedTheme={selectedTheme} customPrompt={customPrompt} customThemeName={customThemeName} apiKey={apiKey} onCreateTheme={() => { void generateSelectedAssets() }} onStartGame={handleStartGame} />
    </div>
  </div>
}

export default SideMenu
