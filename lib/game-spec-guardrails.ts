import { normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AssetCategory, AssetDefinition, GameSpec, LevelSpec, PlatformMode } from '@/types'

const GROUND_ENEMY_CATEGORIES = new Set<AssetCategory>([
  'groundEnemy', 'groundEnemyAttackEffect', 'groundEnemyMotion', 'groundEnemyAttackSound', 'groundEnemyMoveSound',
])
const AIR_ENEMY_CATEGORIES = new Set<AssetCategory>([
  'airEnemy', 'airEnemyAttackEffect', 'airEnemyMotion', 'airEnemyAttackSound', 'airEnemyMoveSound',
])
const WATER_ENEMY_CATEGORIES = new Set<AssetCategory>([
  'waterEnemy', 'waterEnemyAttackEffect', 'waterEnemyMotion', 'waterEnemyAttackSound', 'waterEnemyMoveSound',
])
const BOSS_CATEGORIES = new Set<AssetCategory>([
  'boss', 'bossAttackEffect', 'bossMotion', 'bossAttackSound', 'bossMoveSound',
])

function inferredPlatformMode(level: LevelSpec): PlatformMode {
  const source = `${level.name} ${level.environment}`
  if (/underwater|submerged|river cavern|ocean|water zone|地下河|水域|水下|海洋/i.test(source)) return 'water'
  if (/upper tower|aerial|floating island|sky realm|cloud sea|法师塔|空中|大气|漂浮/i.test(source)) return 'air'
  if (/castle|hall|sanctuary|gate|forest|desert|ruin|城门|王座厅|圣殿|森林|沙漠|遗迹/i.test(source)) return 'ground'
  return level.platformMode
}

function compatibleLevelIds(category: AssetCategory, levels: LevelSpec[]): string[] | null {
  if (GROUND_ENEMY_CATEGORIES.has(category)) return levels.filter((level) => level.platformMode === 'ground').map((level) => level.id)
  if (AIR_ENEMY_CATEGORIES.has(category)) return levels.filter((level) => level.platformMode !== 'water').map((level) => level.id)
  if (WATER_ENEMY_CATEGORIES.has(category)) return levels.filter((level) => level.platformMode === 'water').map((level) => level.id)
  if (category === 'waterPlatform') return levels.filter((level) => level.platformMode === 'water').map((level) => level.id)
  if (category === 'airPlatform') return levels.filter((level) => level.platformMode === 'air').map((level) => level.id)
  if (category === 'groundPlatform') return levels.map((level) => level.id)
  if (BOSS_CATEGORIES.has(category)) return levels.length ? [levels[levels.length - 1].id] : []
  return null
}

function keepCompatibleAssignments(asset: AssetDefinition, levels: LevelSpec[]): AssetDefinition {
  const allowed = compatibleLevelIds(asset.category, levels)
  const known = new Set(levels.map((level) => level.id))
  const current = asset.levelIds.filter((id) => known.has(id))
  const levelIds = allowed
    ? current.filter((id) => allowed.includes(id))
    : current
  const repairedIds = allowed && asset.enabled && levelIds.length === 0 && allowed.length > 0
    ? [allowed[0]]
    : levelIds
  return {
    ...asset,
    levelIds: repairedIds,
    animation: asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : asset.animation,
  }
}

function synchronizeEnemyBundle(assets: AssetDefinition[], categories: Set<AssetCategory>): AssetDefinition[] {
  const entity = assets.find((asset) => categories.has(asset.category) && asset.kind === 'spriteSheet')
  if (!entity || !entity.enabled) return assets
  return assets.map((asset) => categories.has(asset.category) && asset.enabled
    ? { ...asset, levelIds: [...entity.levelIds] }
    : asset)
}

function concreteBackgroundPrompt(asset: AssetDefinition, levels: LevelSpec[]): AssetDefinition {
  if (asset.category !== 'levelBackground') return asset
  const level = levels.find((item) => asset.levelIds.includes(item.id))
  if (!level) return asset
  const prompt = `Environment-only 16-bit side-scrolling pixel-art background for “${level.name}”. ${level.environment} Wide readable traversal lane, layered parallax depth, no hero, no enemy, no boss, no weapon, no pickup, no foreground obstacle, no words, no logo, no UI.`
  const isGeneric = /placeholder|region\s*\d|generated from|describe this level|关卡背景描述|等待补充/i.test(asset.prompt)
  return { ...asset, prompt: isGeneric || !asset.prompt.includes(level.environment) ? prompt : asset.prompt }
}

/**
 * Deterministic, idempotent safeguards applied after model output normalization.
 * They correct engine contradictions without inventing new creative content.
 */
export function stabilizeGameSpec(spec: GameSpec): GameSpec {
  const levels = spec.levels.map((level, index) => ({
    ...level,
    platformMode: inferredPlatformMode(level),
    enemyCount: Math.min(index === spec.levels.length - 1 ? 5 : 6, Math.max(0, Math.round(level.enemyCount))),
    collectibleCount: Math.min(8, Math.max(1, Math.round(level.collectibleCount))),
    hasBoss: index === spec.levels.length - 1,
  }))

  let assets = spec.assets
    .map((asset) => keepCompatibleAssignments(asset, levels))
    .map((asset) => concreteBackgroundPrompt(asset, levels))
  assets = synchronizeEnemyBundle(assets, GROUND_ENEMY_CATEGORIES)
  assets = synchronizeEnemyBundle(assets, AIR_ENEMY_CATEGORIES)
  assets = synchronizeEnemyBundle(assets, WATER_ENEMY_CATEGORIES)
  assets = synchronizeEnemyBundle(assets, BOSS_CATEGORIES)

  return {
    ...spec,
    weapon: { ...spec.weapon, cooldownMs: 420 },
    levels,
    assets,
  }
}
