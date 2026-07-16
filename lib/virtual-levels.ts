import { PRESET_THEMES } from '@/configs'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { getThemeId } from '@/lib/theme-utils'
import type { GameData, Theme } from '@/types'

const DEFAULT_VIRTUAL_LEVEL_COUNT = 3

function resolveSavedTheme(selectedTheme: string): Theme | undefined {
  let theme = PRESET_THEMES.find((item) => item.id === selectedTheme) as Theme | undefined
  if (typeof window === 'undefined') return theme
  try {
    const savedThemes = localStorage.getItem('pixel-seed-themes')
    if (savedThemes) {
      const updated = (JSON.parse(savedThemes) as Theme[]).find((item) => item.id === selectedTheme)
      if (updated) theme = updated
    }
  } catch {
    // Ignore malformed legacy storage.
  }
  return theme
}

export function buildVirtualGameData(theme: Theme, levelCount: number): GameData {
  const count = Math.max(2, Math.min(10, levelCount))
  const spec = theme.spec || createFallbackGameSpec(theme.description, theme.name, count)
  const levels = Array.from({ length: count }, (_, index) => ({
    id: `virtual-level-${index + 1}`,
    backgroundUrl: theme.backgroundImage || '',
    groundUrl: theme.groundImage || '',
    obstacleUrl: theme.obstacleImage || '',
    obstacles: [],
    enemySpawns: Array.from({ length: 3 + index }, (__, enemyIndex) => ({
      id: `virtual-${index + 1}-enemy-${enemyIndex + 1}`,
      x: 280 + enemyIndex * 140,
      y: 352,
      kind: 'enemy',
    })),
    collectibleSpawns: Array.from({ length: 3 + index }, (__, itemIndex) => ({
      id: `virtual-${index + 1}-collectible-${itemIndex + 1}`,
      x: 220 + itemIndex * 150,
      y: itemIndex % 2 ? 285 : 325,
      kind: 'collectible',
    })),
    bossSpawn: index === count - 1
      ? { id: `virtual-${index + 1}-boss`, x: 780, y: 310, kind: 'boss' }
      : undefined,
  }))

  return {
    success: true,
    data: {
      characterUrl: theme.characterImage || '',
      enemyUrl: theme.enemyImage || theme.obstacleImage || '',
      weaponUrl: theme.weaponImage || '',
      projectileUrl: theme.projectileImage || '',
      attackEffectUrl: theme.attackEffectImage || '',
      collectibleUrl: theme.collectibleImage || '',
      bossUrl: theme.bossImage || theme.obstacleImage || '',
      levels,
      spec: { ...spec, levels: spec.levels.slice(0, count) },
    },
    generationId: `virtual-${getThemeId(theme.id)}-${Date.now()}`,
    timestamp: new Date().toISOString(),
  }
}

export function ensurePlayableLevels(
  selectedTheme: string,
  levelCount: number,
  gameData: GameData,
): GameData {
  if (gameData.data?.levels?.length) return gameData
  const theme = resolveSavedTheme(selectedTheme)
  if (!theme?.backgroundImage) return gameData
  return buildVirtualGameData(theme, Math.max(levelCount, DEFAULT_VIRTUAL_LEVEL_COUNT))
}

export function syncPlayableLevels(
  selectedTheme: string,
  levelCount: number,
  gameData: GameData,
): { gameData: GameData; totalLevels: number } {
  const synced = ensurePlayableLevels(selectedTheme, levelCount, gameData)
  return { gameData: synced, totalLevels: synced.data?.levels?.length || 1 }
}
