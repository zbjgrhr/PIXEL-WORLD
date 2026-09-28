import type { AssetCategory, GameSpec } from '@/types'

/** Original, bundled art: no external URL, key, inference service, or font dependency. */
export const BUILTIN_ART: Partial<Record<AssetCategory, string>> = {
  hero: '/builtin/hero.svg',
  groundEnemy: '/builtin/slime.svg',
  airEnemy: '/builtin/bat.svg',
  waterEnemy: '/builtin/fish.svg',
  boss: '/builtin/golem.svg',
  meleeWeapon: '/builtin/sword.svg',
  rangedWeapon: '/builtin/wand.svg',
  rangedProjectile: '/builtin/projectile.svg',
  meleeAttackEffect: '/builtin/slash.svg',
  rangedAttackEffect: '/builtin/spark.svg',
  groundEnemyAttackEffect: '/builtin/claw.svg',
  airEnemyAttackEffect: '/builtin/feather.svg',
  waterEnemyAttackEffect: '/builtin/bubble.svg',
  bossAttackEffect: '/builtin/flame.svg',
  collectible: '/builtin/crystal.svg',
  groundPlatform: '/builtin/ground.svg',
  waterPlatform: '/builtin/water.svg',
  airPlatform: '/builtin/cloud.svg',
  deathObstacle: '/builtin/spikes.svg',
  bounceObstacle: '/builtin/spring.svg',
  normalObstacle: '/builtin/crate.svg',
  levelBackground: '/builtin/forest.svg',
}

function backgroundFor(description: string, index: number): string {
  if (/snow|ice|frost|winter|冰|雪|寒/i.test(description)) return '/builtin/frost.svg'
  if (/night|space|moon|castle|cave|夜|星|城堡|洞|地牢/i.test(description)) return '/builtin/moon.svg'
  if (/water|ocean|sea|underwater|水|海/i.test(description)) return '/builtin/underwater.svg'
  if (/forest|garden|grass|森林|花园|草地/i.test(description)) return '/builtin/forest.svg'
  return ['/builtin/forest.svg', '/builtin/moon.svg', '/builtin/frost.svg'][index % 3]
}

export function isBuiltinArt(url?: string): boolean {
  return Boolean(url?.startsWith('/builtin/'))
}

/** Keep the compiled mechanics/story; supply honest single-frame artwork for play. */
export function buildBuiltinGameSpec(
  spec: GameSpec,
  theme = '',
  options: { onlyMissing?: boolean } = {},
): GameSpec {
  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      if (!asset.enabled || !['image', 'spriteSheet'].includes(asset.kind)) return asset
      if (options.onlyMissing && (asset.url || Object.values(asset.animation?.clips || {}).some((clip) => clip?.url))) return asset
      const levelIndex = Math.max(0, spec.levels.findIndex((level) => asset.levelIds.includes(level.id)))
      const level = spec.levels[levelIndex]
      const url = asset.category === 'levelBackground'
        ? backgroundFor(level?.environment || theme, levelIndex)
        : BUILTIN_ART[asset.category]
      if (!url) return asset
      return { ...asset, kind: 'image' as const, status: 'success' as const, url, animation: undefined, error: undefined }
    }),
  }
}
