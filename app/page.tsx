'use client'

import React, { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Splitter, message } from 'antd'
import { useGameStore } from '@/lib/store'
import { buildVirtualGameData } from '@/lib/virtual-levels'
import { buildGameDataFromSpec } from '@/lib/virtual-levels'
import { ensureThemeSpec, getThemeSourcePrompt, isStoredTheme } from '@/lib/theme-migration'
import { GameCanvas, ProjectHeader, SideMenu, ThemesList, ThemePreview } from '@/components/ui'
import GameCoverMenu from '@/components/GameCoverMenu'
import { PRESET_THEMES } from '@/configs'
import { getDefaultModel, getDefaultProvider } from '@/configs/image-providers'
import { formatGenerationError } from '@/lib/format-generation-error'
import { loadImageApiPrefs, loadProviderApiKey, saveImageApiPrefs } from '@/lib/image-api-prefs'
import { cacheAssetUrl, stripLargeAssetUrls } from '@/lib/asset-db'
import { prepareAnimationReferenceImages } from '@/lib/animation-references'
import { animationIsComplete, createActionStripAnimation, normalizeAnimationSpec } from '@/lib/asset-catalog'
import { ASSET_TYPES } from '@/types'
import type {
  AnimationClipPose,
  AssetType,
  AssetDefinition,
  GameData,
  GameTheme,
  GenerateImageRequest,
  ProviderId,
  RegeneratingImages,
  Theme,
} from '@/types'

const EMPTY_REGENERATING = Object.fromEntries(
  ASSET_TYPES.map((type) => [type, false]),
) as RegeneratingImages

type ParticleMode = 'petals' | 'rain' | 'snow' | 'embers' | 'mist' | 'stars' | 'bubbles'
type ThemeVariables = CSSProperties & Record<`--${string}`, string>

interface SessionTheme {
  coverUrl: string
  particleMode: ParticleMode
  variables: ThemeVariables
}

const INITIAL_COVER = '/visuals/pixel-adventure-header-v3.png'
const THEME_PARTICLES = Array.from({ length: 32 }, (_, index) => ({
  left: `${(index * 37 + 7) % 100}%`,
  delay: `${-((index * 0.71) % 11).toFixed(2)}s`,
  duration: `${7 + (index % 7) * 0.85}s`,
  drift: `${(index % 2 === 0 ? 1 : -1) * (18 + (index % 5) * 9)}px`,
  size: `${5 + (index % 4) * 2}px`,
}))

const initialThemeVariables: ThemeVariables = {
  '--world-page-bg': '#dff3e8',
  '--world-page-bg-deep': '#b7dfd1',
  '--world-panel': 'rgba(255, 253, 245, .96)',
  '--world-panel-soft': 'rgba(239, 248, 238, .97)',
  '--world-accent': '#3f8b70',
  '--world-accent-deep': '#245f50',
  '--world-ink': '#203d38',
  '--world-muted': '#647d75',
  '--world-border': 'rgba(57, 119, 94, .25)',
  '--particle-primary': '#f59bbb',
  '--particle-secondary': '#ffcc54',
  '--particle-tertiary': '#80c984',
}

function themeVariablesForFilter(filter = 'none'): ThemeVariables {
  if (filter === 'warm' || filter === 'danger') return {
    ...initialThemeVariables,
    '--world-page-bg': '#f8ead3',
    '--world-page-bg-deep': '#eac7a2',
    '--world-panel-soft': 'rgba(255, 246, 229, .97)',
    '--world-accent': '#ba673f',
    '--world-accent-deep': '#7b3f2c',
    '--world-ink': '#4c3329',
    '--world-muted': '#81675a',
    '--world-border': 'rgba(162, 88, 49, .26)',
    '--particle-primary': '#ffb33e',
    '--particle-secondary': '#ef7654',
    '--particle-tertiary': '#ffd77b',
  }
  if (filter === 'dream') return {
    ...initialThemeVariables,
    '--world-page-bg': '#eee8f8',
    '--world-page-bg-deep': '#d2c5e9',
    '--world-panel-soft': 'rgba(247, 242, 255, .97)',
    '--world-accent': '#7966a8',
    '--world-accent-deep': '#514175',
    '--world-ink': '#3c3450',
    '--world-muted': '#756c86',
    '--world-border': 'rgba(107, 86, 157, .25)',
    '--particle-primary': '#d7a8ff',
    '--particle-secondary': '#f5c4ff',
    '--particle-tertiary': '#9fc7ff',
  }
  if (filter === 'underwater' || filter === 'cold') return {
    ...initialThemeVariables,
    '--world-page-bg': '#dceff2',
    '--world-page-bg-deep': '#add5da',
    '--world-panel-soft': 'rgba(235, 248, 249, .97)',
    '--world-accent': '#37818a',
    '--world-accent-deep': '#245d66',
    '--world-ink': '#203d43',
    '--world-muted': '#617b80',
    '--world-border': 'rgba(45, 111, 120, .25)',
    '--particle-primary': '#8ee8ef',
    '--particle-secondary': '#d5fbff',
    '--particle-tertiary': '#5ebac7',
  }
  return initialThemeVariables
}

function particleModeFor(weather = 'none', filter = 'none'): ParticleMode {
  if (weather !== 'none') return weather as Exclude<ParticleMode, 'petals' | 'bubbles'>
  if (filter === 'underwater') return 'bubbles'
  if (filter === 'warm' || filter === 'danger') return 'embers'
  if (filter === 'dream' || filter === 'cold') return 'stars'
  return 'petals'
}

export default function Home() {
  const {
    selectedTheme,
    setSelectedTheme,
    setGameData,
    setGameState,
    setCurrentLevelIndex,
    isLoading,
    loadingMessage,
    loadFromLocalStorage,
    getGameDataForTheme,
    removeGameDataForTheme,
    removeProcessedImagesForTheme,
    updateProcessedImage,
  } = useGameStore()

  const [showGameInterface, setShowGameInterface] = useState(false)
  const [showGameCover, setShowGameCover] = useState(false)
  const [sessionTheme, setSessionTheme] = useState<SessionTheme | null>(null)
  const [themes, setThemes] = useState<Theme[]>([...PRESET_THEMES])
  const [regeneratingImages, setRegeneratingImages] = useState<RegeneratingImages>(EMPTY_REGENERATING)
  const [regeneratingAssetIds, setRegeneratingAssetIds] = useState<string[]>([])
  const themesListRef = useRef<HTMLDivElement>(null)
  const [apiKey, setApiKey] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(getDefaultProvider())
  const [selectedModel, setSelectedModel] = useState(getDefaultModel(getDefaultProvider()))

  const persistPrefs = (provider = selectedProvider, model = selectedModel, key = apiKey) => {
    saveImageApiPrefs({ provider, model, apiKey: key })
  }

  const handleProviderChange = (provider: ProviderId) => {
    const model = getDefaultModel(provider)
    const key = loadProviderApiKey(provider)
    setSelectedProvider(provider)
    setSelectedModel(model)
    setApiKey(key)
    saveImageApiPrefs({ provider, model, apiKey: key })
  }

  const persistThemes = (nextThemes: Theme[]) => {
    try {
      localStorage.setItem('pixel-seed-themes', JSON.stringify(nextThemes))
    } catch (error) {
      console.error('Failed to save themes:', error)
    }
  }

  const saveThemes = (nextThemes: Theme[]) => {
    setThemes(nextThemes)
    persistThemes(nextThemes)
  }

  const updateTheme = (themeId: string, updater: (theme: Theme) => Theme) => {
    setThemes((currentThemes) => {
      const nextThemes = currentThemes.map((theme) => theme.id === themeId ? updater(theme) : theme)
      persistThemes(nextThemes)
      return nextThemes
    })
  }

  useEffect(() => {
    loadFromLocalStorage()
    try {
      const stored = localStorage.getItem('pixel-seed-themes')
      const parsed = stored ? JSON.parse(stored) : []
      const storedThemes = Array.isArray(parsed) ? parsed.filter(isStoredTheme) : []
      const storedById = new Map(storedThemes.map((theme) => [theme.id, theme]))
      const presetIds = new Set(PRESET_THEMES.map((theme) => theme.id))
      const combinedThemes = [
        ...PRESET_THEMES.map((preset) => {
          const savedPreset = storedById.get(preset.id)
          if (!savedPreset) return preset
          return {
            ...preset,
            ...savedPreset,
            name: savedPreset.name?.trim() || preset.name,
            description: savedPreset.description?.trim() || preset.description,
          }
        }),
        ...storedThemes.filter((theme) => !presetIds.has(theme.id)),
      ]
      const savedGameData = useGameStore.getState().gameDataByTheme
      const migratedThemes = combinedThemes.map((theme) => ensureThemeSpec(
        theme,
        savedGameData[theme.id]?.data?.levels?.length,
      ))
      setThemes(migratedThemes)
      persistThemes(migratedThemes)
    } catch {
      const migratedThemes = PRESET_THEMES.map((theme) => ensureThemeSpec(theme))
      setThemes(migratedThemes)
      persistThemes(migratedThemes)
    }
    const prefs = loadImageApiPrefs()
    setSelectedProvider(prefs.provider)
    setSelectedModel(prefs.model)
    setApiKey(prefs.apiKey)
  }, [loadFromLocalStorage])

  const generateImages = async (requestBody: GenerateImageRequest): Promise<GameData> => {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) {
      throw new Error(formatGenerationError(result?.error || `HTTP ${response.status}`))
    }
    return result as GameData
  }

  const handleDeleteTheme = (themeId: string) => {
    if (!themeId.startsWith('custom-')) {
      message.error('预设主题不能删除。')
      return
    }
    saveThemes(themes.filter((theme) => theme.id !== themeId))
    removeGameDataForTheme(themeId)
    removeProcessedImagesForTheme(themeId)
    if (selectedTheme === themeId) setSelectedTheme('fantasy')
    message.success('主题已删除。')
  }

  const handleRegenerateImage = async (
    themeId: string,
    imageType: AssetType,
    key: string,
  ) => {
    setRegeneratingImages((previous) => ({ ...previous, [imageType]: true }))
    try {
      const theme = themes.find((item) => item.id === themeId)
      const existing = getGameDataForTheme(themeId)
      if (!theme) throw new Error('Theme not found')
      const levelCount = Math.max(
        1,
        existing.data?.levels.length || theme.spec?.levels.length || 3,
      )
      const repairedTheme = ensureThemeSpec(theme, levelCount)
      const sourcePrompt = getThemeSourcePrompt(repairedTheme)
      const spec = existing.data?.spec || repairedTheme.spec
      if (!spec) throw new Error('无法建立结构化游戏规格。')
      const result = await generateImages({
        theme: repairedTheme.name,
        prompt: sourcePrompt,
        provider: selectedProvider,
        model: selectedModel,
        types: [imageType],
        levelCount,
        apiKey: key.trim(),
        spec,
      })
      if (!result.data) throw new Error('重新生成结果为空。')

      const isLevelAsset = imageType === 'background' || imageType === 'ground' || imageType === 'obstacle'
      const newUrl = isLevelAsset
        ? result.data.levels[0]?.[`${imageType}Url`]
        : result.data[`${imageType}Url`]
      if (!newUrl) throw new Error('未收到新的素材 URL。')

      const imageField = `${imageType}Image` as keyof Theme
      const resultSpec = result.data.spec || spec
      updateTheme(themeId, (currentTheme) => ({
        ...ensureThemeSpec(currentTheme, levelCount),
        description: sourcePrompt,
        spec: resultSpec,
        [imageField]: newUrl,
      }))

      const latestExisting = useGameStore.getState().getGameDataForTheme(themeId)
      const baseGameData = latestExisting.data
        ? latestExisting
        : buildVirtualGameData({ ...repairedTheme, spec: resultSpec }, levelCount)
      const baseData = baseGameData.data
      if (!baseData) throw new Error('无法建立主题游戏数据。')
      const updatedData = isLevelAsset
        ? {
            ...baseData,
            spec: resultSpec,
            levels: baseData.levels.map((level, index) => ({
              ...level,
              [`${imageType}Url`]: result.data?.levels[index]?.[`${imageType}Url`] || level[`${imageType}Url`],
            })),
          }
        : { ...baseData, spec: resultSpec, [`${imageType}Url`]: newUrl }
      setGameData({
        ...baseGameData,
        success: true,
        data: updatedData,
        generationId: result.generationId || baseGameData.generationId,
        timestamp: result.timestamp || new Date().toISOString(),
      }, themeId)
      updateProcessedImage(themeId, imageType, newUrl)
      message.success(`${imageType} 已重新生成。`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新生成失败。')
    } finally {
      setRegeneratingImages((previous) => ({ ...previous, [imageType]: false }))
    }
  }

  const handleUpdateAsset = (themeId: string, assetId: string, patch: Partial<AssetDefinition>) => {
    const current = getGameDataForTheme(themeId)
    const theme = themes.find((item) => item.id === themeId)
    const spec = current.data?.spec || theme?.spec
    if (!spec) return
    const nextSpec = { ...spec, assets: spec.assets.map((asset) => asset.id === assetId ? { ...asset, ...patch } : asset) }
    updateTheme(themeId, (item) => ({ ...item, spec: nextSpec }))
    const nextData = buildGameDataFromSpec(nextSpec)
    setGameData(nextData, themeId)
  }

  const handleRegenerateAsset = async (themeId: string, assetId: string, key: string, requestedPose?: AnimationClipPose) => {
    const theme = themes.find((item) => item.id === themeId)
    const current = getGameDataForTheme(themeId)
    const spec = current.data?.spec || theme?.spec
    const asset = spec?.assets.find((item) => item.id === assetId)
    if (!theme || !spec || !asset) return void message.error('没有找到需要重新生成的素材。')
    if (!key.trim()) return void message.error('请先填写 API Key。')
    const animationPose = asset.kind === 'spriteSheet' ? requestedPose || 'idle' : undefined
    const regenerationKey = animationPose ? `${assetId}:${animationPose}` : assetId
    setRegeneratingAssetIds((items) => [...items, regenerationKey])
    handleUpdateAsset(themeId, assetId, { status: 'generating', error: undefined })
    try {
      const levelIndex = Math.max(0, spec.levels.findIndex((level) => level.id === asset.levelIds[0]))
      const referenceImages = animationPose
        ? await prepareAnimationReferenceImages(spec, asset, animationPose)
        : []
      const response = await fetch('/api/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: spec.title, prompt: asset.prompt, provider: selectedProvider, model: selectedModel, apiKey: key.trim(), levelCount: spec.levels.length, spec: stripLargeAssetUrls(spec), asset: stripLargeAssetUrls({ ...spec, assets: [asset] }).assets[0], levelIndex, animationPose, referenceImages }),
      })
      const result = await response.json().catch(() => null)
      const generatedAsset = result?.data?.asset as AssetDefinition | undefined
      const generatedClip = animationPose ? normalizeAnimationSpec(generatedAsset?.animation).clips?.[animationPose] : undefined
      if (!response.ok || !result?.success || (!animationPose && !generatedAsset?.url) || (animationPose && !generatedClip?.url)) throw new Error(formatGenerationError(result?.error || `HTTP ${response.status}`))
      let completedAsset: AssetDefinition
      if (animationPose) {
        const currentAnimation = asset.animation?.layoutVersion === 3 ? normalizeAnimationSpec(asset.animation) : createActionStripAnimation()
        completedAsset = {
          ...asset,
          ...generatedAsset!,
          animation: { ...currentAnimation, clips: { ...currentAnimation.clips, [animationPose]: generatedClip } },
          url: animationPose === 'idle' ? generatedClip?.url : asset.url,
          error: undefined,
        }
        completedAsset.status = animationIsComplete(completedAsset) ? 'success' : 'pending'
      } else {
        completedAsset = { ...generatedAsset!, status: 'success', error: undefined }
      }
      try {
        const cacheKey = animationPose ? `${assetId}:clip:${animationPose}` : assetId
        await cacheAssetUrl(themeId, cacheKey, animationPose ? generatedClip?.url || '' : completedAsset.url || '')
        if (animationPose === 'idle' && generatedClip?.url) await cacheAssetUrl(themeId, assetId, generatedClip.url)
      } catch (cacheError) {
        console.warn('Failed to replace cached regenerated asset:', cacheError)
        message.warning('新素材已生成并应用，但浏览器缓存保存失败；刷新前请先导出或重新保存项目。')
      }
      handleUpdateAsset(themeId, assetId, completedAsset)
      message.success(`${asset.title}${animationPose ? ` · ${animationPose}` : ''} 已重新生成。`)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Generation failed.'
      if (animationPose && asset.animation?.layoutVersion === 3) {
        const animation = normalizeAnimationSpec(asset.animation)
        handleUpdateAsset(themeId, assetId, { status: 'failed', error: errorMessage, animation: { ...animation, clips: { ...animation.clips, [animationPose]: { ...animation.clips?.[animationPose]!, status: 'failed', error: errorMessage } } } })
      } else handleUpdateAsset(themeId, assetId, { status: 'failed', error: errorMessage })
      message.error(error instanceof Error ? error.message : '素材重新生成失败。')
    } finally {
      setRegeneratingAssetIds((items) => items.filter((id) => id !== regenerationKey))
    }
  }

  const activeGameData = getGameDataForTheme(selectedTheme)
  const activeTheme = themes.find((theme) => theme.id === selectedTheme)

  const openGameCover = () => {
    const state = useGameStore.getState()
    const currentData = state.getGameDataForTheme(state.selectedTheme)
    const currentTheme = themes.find((theme) => theme.id === state.selectedTheme)
    const firstLevel = currentData.data?.levels[0]
    const firstLevelSpec = currentData.data?.spec.levels[0] || currentTheme?.spec?.levels[0]
    const coverUrl = firstLevel?.backgroundUrl
      || currentData.data?.spec.assets.find((asset) => asset.enabled && asset.category === 'levelBackground' && asset.url)?.url
      || currentTheme?.backgroundImage
      || INITIAL_COVER
    const filter = firstLevelSpec?.effects.filter || 'none'
    const weather = firstLevelSpec?.effects.weather || 'none'

    setSessionTheme({
      coverUrl,
      particleMode: particleModeFor(weather, filter),
      variables: themeVariablesForFilter(filter),
    })
    setShowGameInterface(false)
    setShowGameCover(true)
  }

  const startGame = (fromBeginning: boolean) => {
    if (fromBeginning) setCurrentLevelIndex(0)
    setGameState('playing')
    setShowGameCover(false)
    setShowGameInterface(true)
  }

  const returnToCover = () => {
    setGameState('menu')
    setShowGameInterface(false)
    setShowGameCover(true)
  }

  const exitCover = () => {
    setGameState('menu')
    setShowGameCover(false)
    setShowGameInterface(false)
  }

  const coverUrl = sessionTheme?.coverUrl || INITIAL_COVER
  const rootStyle = {
    ...(sessionTheme?.variables || initialThemeVariables),
    '--world-banner-image': `url("${coverUrl.replace(/"/g, '%22')}")`,
  } as ThemeVariables
  const particleMode = sessionTheme?.particleMode || 'petals'

  return (
    <main
      className={`min-h-screen pixel-world-app${sessionTheme ? ' has-session-cover' : ''}`}
      style={rootStyle}
    >
      <div className={`theme-particles particle-mode-${particleMode}`} aria-hidden="true">
        {THEME_PARTICLES.map((particle, index) => (
          <span
            key={index}
            style={{
              '--particle-left': particle.left,
              '--particle-delay': particle.delay,
              '--particle-duration': particle.duration,
              '--particle-drift': particle.drift,
              '--particle-size': particle.size,
            } as ThemeVariables}
          />
        ))}
      </div>
      {showGameCover ? (
        <GameCoverMenu
          theme={activeTheme}
          gameData={activeGameData}
          coverUrl={coverUrl}
          canLoad={Boolean(activeGameData.data?.levels.length)}
          onStartNew={() => startGame(true)}
          onLoad={() => startGame(false)}
          onExit={exitCover}
        />
      ) : showGameInterface ? (
        <div className="game-runtime-shell">
          <GameCanvas loadingMessage={loadingMessage} onBackToMenu={returnToCover} />
        </div>
      ) : (
        <div className="pixel-world-shell">
          <ProjectHeader />
          <div className="world-content-frame">
            <Splitter className="world-splitter">
              <Splitter.Panel
                defaultSize={410}
                min={360}
                max={480}
                className="creator-panel"
              >
                <SideMenu
                  apiKey={apiKey}
                  onApiKeyChange={(value) => { setApiKey(value); persistPrefs(selectedProvider, selectedModel, value) }}
                  selectedProvider={selectedProvider}
                  onProviderChange={handleProviderChange}
                  selectedModel={selectedModel}
                  onModelChange={(value) => { setSelectedModel(value); persistPrefs(selectedProvider, value, apiKey) }}
                  onStartGame={openGameCover}
                  onThemeUpdate={saveThemes}
                  generateImages={generateImages}
                  onRegeneratingImagesChange={setRegeneratingImages}
                  themesListRef={themesListRef}
                />
              </Splitter.Panel>

              <Splitter.Panel className="workspace-panel" style={{ padding: 20, overflowY: 'auto' }}>
              <div style={{ display: 'flex', gap: 20, width: '100%', height: '100%' }}>
                <ThemesList
                  ref={themesListRef}
                  themes={themes}
                  selectedTheme={selectedTheme as GameTheme}
                  onThemeSelect={setSelectedTheme}
                />
                <ThemePreview
                  isLoading={isLoading}
                  loadingMessage={loadingMessage}
                  selectedTheme={selectedTheme}
                  themes={themes}
                  gameData={activeGameData}
                  regeneratingImages={regeneratingImages}
                  apiKey={apiKey}
                  onRegenerateImage={handleRegenerateImage}
                  regeneratingAssetIds={regeneratingAssetIds}
                  onRegenerateAsset={handleRegenerateAsset}
                  onUpdateAsset={handleUpdateAsset}
                  onDeleteTheme={handleDeleteTheme}
                />
              </div>
              </Splitter.Panel>
            </Splitter>
          </div>
        </div>
      )}
    </main>
  )
}
