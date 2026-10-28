import type { AssetDefinition, EnemySpec, GameSpec } from '@/types'

export type EnemyAssetCategory = 'groundEnemy' | 'airEnemy' | 'waterEnemy'

const legacyCategory: EnemyAssetCategory[] = ['groundEnemy', 'airEnemy', 'waterEnemy']

export function enemyCategory(enemy: EnemySpec, index: number): EnemyAssetCategory | undefined {
  return enemy.category || legacyCategory[index]
}

export function enemySpecForAsset(spec: Pick<GameSpec, 'enemies'>, asset?: Pick<AssetDefinition, 'id' | 'category'>): EnemySpec {
  const matched = spec.enemies.find(enemy => asset && enemy.assetId === asset.id)
    || spec.enemies.find((enemy, index) => asset && enemyCategory(enemy, index) === asset.category)
  return matched || spec.enemies[0]
}

export function enabledEnemyNamesForLevel(spec: Pick<GameSpec, 'enemies' | 'assets'>, levelId: string): string[] {
  const available = spec.assets.filter(asset => asset.enabled && legacyCategory.includes(asset.category as EnemyAssetCategory) && asset.levelIds.includes(levelId))
  return available.map(asset => enemySpecForAsset(spec, asset)?.name).filter((name): name is string => Boolean(name))
}
