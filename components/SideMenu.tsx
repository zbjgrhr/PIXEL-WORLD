'use client'

import React, { useState } from 'react'
import { message } from 'antd'
import { useGameStore } from '@/lib/store'
import { isPresetTheme, resolveValidTheme } from '@/lib/theme-utils'
import { ProjectHeader, ModelSelector, ThemeCustomizer, ActionButtons } from './ui/index'
import { PRESET_THEMES } from '@/configs'
import { syncPlayableLevels } from '@/lib/virtual-levels'
import { formatGenerationError } from '@/lib/format-generation-error'
import { ASSET_TYPES } from '@/types'
import type {
  GameData,
  GameSpec,
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

const EMPTY_GENERATING = Object.fromEntries(
  ASSET_TYPES.map((type) => [type, false]),
) as RegeneratingImages

const ALL_GENERATING = Object.fromEntries(
  ASSET_TYPES.map((type) => [type, true]),
) as RegeneratingImages

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
  generateImages,
  onRegeneratingImagesChange,
  themesListRef,
  className,
  style,
}) => {
  const {
    selectedTheme,
    customPrompt,
    levelCount,
    setSelectedTheme,
    setCustomPrompt,
    setLevelCount,
    setGameState,
    setLoadingMessage,
    gameData,
    setGameData,
    isLoading,
    setLoading,
  } = useGameStore()

  const [customThemeName, setCustomThemeName] = useState('')
  const [isThemeCreated, setIsThemeCreated] = useState(false)
  const [presetThemes, setPresetThemes] = useState<Theme[]>([...PRESET_THEMES])
  const [optimizedSpec, setOptimizedSpec] = useState<GameSpec | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)

  const optimizePrompt = async (
    quiet = false,
    promptOverride?: string,
    themeOverride?: string,
  ): Promise<GameSpec | null> => {
    const prompt = (promptOverride ?? customPrompt).trim()
    if (!prompt) {
      if (!quiet) message.error('请先输入游戏构想。')
      return null
    }
    setIsOptimizing(true)
    try {
      const response = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          theme: themeOverride?.trim() || customThemeName.trim() || 'Pixel World',
          levelCount,
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || '提示词优化失败')
      const spec = result.data.spec as GameSpec
      setOptimizedSpec(spec)
      setCustomPrompt(result.data.optimizedPrompt)
      if (!quiet) {
        message.success(result.data.source === 'ai' ? 'AI 已完成结构化优化。' : '已完成本地结构化优化。')
        if (result.data.warning) message.info(result.data.warning, 4)
      }
      return spec
    } catch (error) {
      if (!quiet) message.error(error instanceof Error ? error.message : '提示词优化失败')
      return null
    } finally {
      setIsOptimizing(false)
    }
  }

  const handlePromptChange = (value: string) => {
    setCustomPrompt(value)
    setOptimizedSpec(null)
  }

  const handleCreateTheme = async () => {
    const hasCustomInput = Boolean(customThemeName.trim() || customPrompt.trim())
    if (hasCustomInput && (!customThemeName.trim() || !customPrompt.trim())) {
      message.error('自定义生成需要同时填写主题名称和游戏构想。')
      return
    }
    if (!apiKey.trim()) {
      message.error('图像生成需要 API Key。')
      return
    }

    const selectedPreset = presetThemes.find((theme) => theme.id === selectedTheme)
    const themeName = hasCustomInput ? customThemeName.trim() : selectedPreset?.name || 'Pixel World'
    const sourcePrompt = hasCustomInput ? customPrompt : selectedPreset?.description || ''
    const fallbackTheme = resolveValidTheme(selectedTheme)
    let spec = optimizedSpec

    if (!spec || spec.levels.length !== levelCount) {
      if (!hasCustomInput && sourcePrompt) {
        setCustomPrompt(sourcePrompt)
        setCustomThemeName(themeName)
      }
      spec = await optimizePrompt(true, sourcePrompt, themeName)
      if (!spec) {
        message.error('无法建立结构化游戏规格，请先点击“一键优化提示词”。')
        return
      }
    }

    const loadingId = `loading-${Date.now()}` as const
    const loadingTheme: Theme = {
      id: loadingId,
      name: themeName,
      description: sourcePrompt,
      characterImage: '',
      backgroundImage: '',
      groundImage: '',
      obstacleImage: '',
      spec,
      isLoading: true,
    }
    const themesWithLoading = [...presetThemes, loadingTheme]

    try {
      setLoading(true)
      setLoadingMessage(`正在生成 ${levelCount} 个完整关卡与 10 类隔离素材…`)
      setGameState('loading')
      onRegeneratingImagesChange?.(ALL_GENERATING)
      setPresetThemes(themesWithLoading)
      setSelectedTheme(loadingId)
      onThemeUpdate?.(themesWithLoading)

      if (!generateImages) throw new Error('图像生成服务未连接。')
      const requestBody: GenerateImageRequest = {
        theme: themeName,
        prompt: sourcePrompt,
        provider: selectedProvider,
        model: selectedModel,
        types: ASSET_TYPES,
        levelCount,
        apiKey: apiKey.trim(),
        spec,
      }
      const result = await generateImages(requestBody)
      if (!result.success || !result.data) throw new Error('生成结果不完整。')

      const finalId = `custom-${Date.now()}` as const
      setGameData(result, finalId)
      useGameStore.getState().removeGameDataForTheme(loadingId)
      const firstLevel = result.data.levels[0]
      const updateProcessed = useGameStore.getState().updateProcessedImage
      const globalTypes = ['character', 'enemy', 'weapon', 'projectile', 'attackEffect', 'collectible', 'boss'] as const
      globalTypes.forEach((type) => {
        const url = result.data?.[`${type}Url`]
        if (url) updateProcessed(finalId, type, url)
      })
      ;(['background', 'ground', 'obstacle'] as const).forEach((type) => {
        const url = firstLevel?.[`${type}Url`]
        if (url) updateProcessed(finalId, type, url)
      })

      const finalTheme: Theme = {
        id: finalId,
        name: themeName,
        description: sourcePrompt,
        characterImage: result.data.characterUrl,
        backgroundImage: firstLevel?.backgroundUrl || '',
        groundImage: firstLevel?.groundUrl || '',
        obstacleImage: firstLevel?.obstacleUrl || '',
        enemyImage: result.data.enemyUrl,
        weaponImage: result.data.weaponUrl,
        projectileImage: result.data.projectileUrl,
        attackEffectImage: result.data.attackEffectUrl,
        collectibleImage: result.data.collectibleUrl,
        bossImage: result.data.bossUrl,
        spec: result.data.spec,
      }
      const finalThemes = themesWithLoading.map((theme) => theme.id === loadingId ? finalTheme : theme)
      setPresetThemes(finalThemes)
      onThemeUpdate?.(finalThemes)
      setSelectedTheme(finalId)
      setIsThemeCreated(true)
      setGameState('menu')
      setLoadingMessage('完整可玩世界已生成。')
      message.success('完整游戏素材与关卡已生成！')
      onCreateTheme?.()
      setTimeout(() => {
        if (themesListRef?.current) themesListRef.current.scrollTop = themesListRef.current.scrollHeight
      }, 100)
    } catch (error) {
      message.error(formatGenerationError(error instanceof Error ? error.message : '生成失败'))
      const restored = themesWithLoading.filter((theme) => theme.id !== loadingId)
      setPresetThemes(restored)
      onThemeUpdate?.(restored)
      useGameStore.getState().removeGameDataForTheme(loadingId)
      setSelectedTheme(fallbackTheme)
      setGameState('menu')
    } finally {
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

  return (
    <div className={className} style={{ padding: 20, height: '100%', overflowY: 'auto', ...style }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
        <ProjectHeader />
        <ModelSelector
          selectedProvider={selectedProvider}
          onProviderChange={onProviderChange}
          selectedModel={selectedModel}
          onModelChange={onModelChange}
          apiKey={apiKey}
          onApiKeyChange={onApiKeyChange}
        />
        <ThemeCustomizer
          customThemeName={customThemeName}
          onThemeNameChange={setCustomThemeName}
          customPrompt={customPrompt}
          onPromptChange={handlePromptChange}
          levelCount={levelCount}
          onLevelCountChange={(count) => { setLevelCount(count); setOptimizedSpec(null) }}
          onOptimizePrompt={() => { void optimizePrompt(false) }}
          isOptimizing={isOptimizing}
          optimizedSpec={optimizedSpec}
        />
        <ActionButtons
          isThemeCreated={isThemeCreated}
          isLoading={isLoading}
          selectedTheme={selectedTheme}
          customPrompt={customPrompt}
          customThemeName={customThemeName}
          apiKey={apiKey}
          onCreateTheme={handleCreateTheme}
          onStartGame={handleStartGame}
        />
      </div>
    </div>
  )
}

export default SideMenu
