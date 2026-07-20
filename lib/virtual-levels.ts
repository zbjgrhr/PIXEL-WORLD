import { PRESET_THEMES } from '@/configs'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { getThemeId } from '@/lib/theme-utils'
import type { GameData, Theme } from '@/types'
import type { AssetCategory, AssetDefinition, GameSpec, ObstacleData } from '@/types'

const DEFAULT_VIRTUAL_LEVEL_COUNT = 3

function activeAsset(assets: AssetDefinition[], category: AssetCategory, levelId?: string): AssetDefinition | undefined {
  return assets.find((asset) => asset.enabled && asset.category === category && (!levelId || asset.levelIds.includes(levelId)) && asset.url)
}

export function buildGameDataFromSpec(spec: GameSpec): GameData {
  const assets = spec.assets || []
  const globalUrl = (category: AssetCategory) => activeAsset(assets, category)?.url || ''
  const levels = spec.levels.map((level, levelIndex) => {
    const obstacleCategories: AssetCategory[] = ['normalObstacle', 'bounceObstacle', 'deathObstacle']
    const enabledObstacles = obstacleCategories.filter((category) => activeAsset(assets, category, level.id))
    const obstacleCount = Math.min(8, 3 + levelIndex)
    const obstacles: ObstacleData[] = Array.from({ length: obstacleCount }, (_, index) => ({
      id: `${level.id}-obstacle-${index + 1}`,
      x: 190 + index * Math.max(75, Math.floor(600 / Math.max(1, obstacleCount))),
      y: 352,
      width: 48,
      height: 48,
      type: enabledObstacles[index % Math.max(1, enabledObstacles.length)] || 'normalObstacle',
    }))
    const enemyAssets = assets.filter((asset) => asset.enabled && ['groundEnemy', 'airEnemy', 'waterEnemy'].includes(asset.category) && asset.levelIds.includes(level.id))
    return {
      id: level.id,
      backgroundUrl: activeAsset(assets, 'levelBackground', level.id)?.url || '',
      groundUrl: activeAsset(assets, 'groundPlatform', level.id)?.url || '',
      obstacleUrl: activeAsset(assets, 'normalObstacle', level.id)?.url || activeAsset(assets, 'bounceObstacle', level.id)?.url || '',
      obstacles,
      enemySpawns: Array.from({ length: level.enemyCount }, (_, index) => ({
        id: `${level.id}-enemy-${index + 1}`,
        x: 270 + index * Math.max(80, Math.floor(560 / Math.max(1, level.enemyCount))),
        y: 352 - (index % 2) * 55,
        kind: enemyAssets[index % Math.max(1, enemyAssets.length)]?.id || 'groundEnemy',
      })),
      collectibleSpawns: Array.from({ length: level.collectibleCount }, (_, index) => ({
        id: `${level.id}-collectible-${index + 1}`,
        x: 220 + index * 120,
        y: index % 2 ? 285 : 325,
        kind: 'collectible',
      })),
      bossSpawn: level.hasBoss && activeAsset(assets, 'boss', level.id)
        ? { id: `${level.id}-boss`, x: 780, y: 310, kind: activeAsset(assets, 'boss', level.id)?.id || 'boss' }
        : undefined,
    }
  })
  return {
    success: true,
    data: {
      characterUrl: globalUrl('hero'),
      enemyUrl: globalUrl('groundEnemy') || globalUrl('airEnemy') || globalUrl('waterEnemy'),
      weaponUrl: globalUrl('meleeWeapon'),
      projectileUrl: globalUrl('rangedProjectile'),
      attackEffectUrl: globalUrl('meleeAttackEffect'),
      collectibleUrl: globalUrl('collectible'),
      bossUrl: globalUrl('boss'),
      levels,
      spec,
    },
    generationId: `v3-${Date.now()}`,
    timestamp: new Date().toISOString(),
  }
}

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
