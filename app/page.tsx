'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Splitter, message } from 'antd'
import { useGameStore } from '@/lib/store'
import { isCustomTheme } from '@/lib/theme-utils'
import { GameCanvas, SideMenu, ThemesList, ThemePreview } from '@/components/ui'
import { PRESET_THEMES } from '@/configs'
import { getDefaultModel, getDefaultProvider } from '@/configs/image-providers'
import { formatGenerationError } from '@/lib/format-generation-error'
import { loadImageApiPrefs, saveImageApiPrefs } from '@/lib/image-api-prefs'
import { ASSET_TYPES } from '@/types'
import type {
  AssetType,
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

export default function Home() {
  const {
    selectedTheme,
    setSelectedTheme,
    setGameData,
    isLoading,
    loadingMessage,
    loadFromLocalStorage,
    getGameDataForTheme,
    removeGameDataForTheme,
    removeProcessedImagesForTheme,
    updateProcessedImage,
  } = useGameStore()

  const [showGameInterface, setShowGameInterface] = useState(false)
  const [themes, setThemes] = useState<Theme[]>([...PRESET_THEMES])
  const [regeneratingImages, setRegeneratingImages] = useState<RegeneratingImages>(EMPTY_REGENERATING)
  const themesListRef = useRef<HTMLDivElement>(null)
  const [apiKey, setApiKey] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(getDefaultProvider())
  const [selectedModel, setSelectedModel] = useState(getDefaultModel(getDefaultProvider()))

  const persistPrefs = (provider = selectedProvider, model = selectedModel, key = apiKey) => {
    saveImageApiPrefs({ provider, model, apiKey: key })
  }

  const saveThemes = (nextThemes: Theme[]) => {
    setThemes(nextThemes)
    try {
      localStorage.setItem('pixel-seed-themes', JSON.stringify(nextThemes))
    } catch (error) {
      console.error('Failed to save themes:', error)
    }
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem('pixel-seed-themes')
      if (stored) setThemes(JSON.parse(stored) as Theme[])
    } catch {
      setThemes([...PRESET_THEMES])
    }
    loadFromLocalStorage()
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
      const spec = existing.data?.spec || theme.spec
      if (!spec) throw new Error('该主题没有结构化游戏规格，请重新生成主题。')
      const result = await generateImages({
        theme: theme.name,
        prompt: theme.description,
        provider: selectedProvider,
        model: selectedModel,
        types: [imageType],
        levelCount: existing.data?.levels.length || spec.levels.length,
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
      saveThemes(themes.map((item) => item.id === themeId ? { ...item, [imageField]: newUrl } : item))
      updateProcessedImage(themeId, imageType, newUrl)

      if (isCustomTheme(themeId) && existing.data) {
        const data = existing.data
        const updatedData = isLevelAsset
          ? {
              ...data,
              levels: data.levels.map((level, index) => ({
                ...level,
                [`${imageType}Url`]: result.data?.levels[index]?.[`${imageType}Url`] || level[`${imageType}Url`],
              })),
            }
          : { ...data, [`${imageType}Url`]: newUrl }
        setGameData({ ...existing, data: updatedData }, themeId)
      }
      message.success(`${imageType} 已重新生成。`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重新生成失败。')
    } finally {
      setRegeneratingImages((previous) => ({ ...previous, [imageType]: false }))
    }
  }

  const activeGameData = getGameDataForTheme(selectedTheme)

  return (
    <main className="min-h-screen">
      <div style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
        <Splitter style={{ height: '100vh' }}>
          <Splitter.Panel
            defaultSize={410}
            min={360}
            max={480}
            style={{ backgroundColor: '#fff', borderRight: '1px solid #e8e8e8', boxShadow: '2px 0 8px rgba(0,0,0,.1)' }}
          >
            <SideMenu
              apiKey={apiKey}
              onApiKeyChange={(value) => { setApiKey(value); persistPrefs(selectedProvider, selectedModel, value) }}
              selectedProvider={selectedProvider}
              onProviderChange={(value) => { setSelectedProvider(value); persistPrefs(value, selectedModel, apiKey) }}
              selectedModel={selectedModel}
              onModelChange={(value) => { setSelectedModel(value); persistPrefs(selectedProvider, value, apiKey) }}
              onStartGame={() => setShowGameInterface(true)}
              onThemeUpdate={saveThemes}
              generateImages={generateImages}
              onRegeneratingImagesChange={setRegeneratingImages}
              themesListRef={themesListRef}
            />
          </Splitter.Panel>

          <Splitter.Panel style={{ padding: 20, overflowY: 'auto' }}>
            {!showGameInterface ? (
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
                  onDeleteTheme={handleDeleteTheme}
                />
              </div>
            ) : (
              <GameCanvas loadingMessage={loadingMessage} onBackToMenu={() => setShowGameInterface(false)} />
            )}
          </Splitter.Panel>
        </Splitter>
      </div>
    </main>
  )
}
