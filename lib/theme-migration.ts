import { createFallbackGameSpec, normalizeGameSpec } from '@/lib/game-spec'
import type { Theme } from '@/types'

const DEFAULT_LEVEL_COUNT = 3

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getThemeSourcePrompt(theme: Theme): string {
  const name = stringValue(theme.name) || 'Pixel World'
  return stringValue(theme.description)
    || `A cohesive 2D side-scrolling pixel action world inspired by ${name}, with a distinct hero, enemies, weapons, projectiles, attack effects, collectibles, a boss, readable platforms, and isolated reusable game assets.`
}

export function ensureThemeSpec(theme: Theme, requestedLevelCount?: number): Theme {
  const name = stringValue(theme.name) || 'Pixel World'
  const description = getThemeSourcePrompt({ ...theme, name })
  const levelCount = Math.min(
    10,
    Math.max(1, requestedLevelCount || theme.spec?.levels?.length || DEFAULT_LEVEL_COUNT),
  )
  const fallback = createFallbackGameSpec(description, name, levelCount)
  const spec = normalizeGameSpec(theme.spec || fallback, fallback, levelCount)

  return {
    ...theme,
    name,
    description,
    characterImage: stringValue(theme.characterImage),
    backgroundImage: stringValue(theme.backgroundImage),
    groundImage: stringValue(theme.groundImage),
    obstacleImage: stringValue(theme.obstacleImage),
    enemyImage: stringValue(theme.enemyImage),
    weaponImage: stringValue(theme.weaponImage),
    projectileImage: stringValue(theme.projectileImage),
    attackEffectImage: stringValue(theme.attackEffectImage),
    collectibleImage: stringValue(theme.collectibleImage),
    bossImage: stringValue(theme.bossImage),
    spec,
  }
}

export function isStoredTheme(value: unknown): value is Theme {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<Theme>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string'
}
