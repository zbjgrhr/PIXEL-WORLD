import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec } from './game-spec'
import { enemySpecForAsset, enabledEnemyNamesForLevel } from './enemy-identity'

describe('enemy identity in playable levels', () => {
  it('uses the matching enemy plan instead of assigning the first enemy to every sprite', () => {
    const spec = createFallbackGameSpec('邮差寻找失踪的信。', '云中邮差', 2)
    spec.enemies = [
      { ...spec.enemies[0], name: '风息者', health: 30, category: 'groundEnemy' },
      { ...spec.enemies[0], name: '云哨兵', health: 45, category: 'airEnemy' },
    ]
    const ground = spec.assets.find(asset => asset.category === 'groundEnemy')!
    const air = spec.assets.find(asset => asset.category === 'airEnemy')!
    ground.enabled = true
    ground.levelIds = [spec.levels[0].id]
    air.enabled = true
    air.levelIds = [spec.levels[0].id]
    expect(enemySpecForAsset(spec, ground).name).toBe('风息者')
    expect(enemySpecForAsset(spec, air).health).toBe(45)
    expect(enabledEnemyNamesForLevel(spec, spec.levels[0].id)).toEqual(['风息者', '云哨兵'])
    delete spec.enemies[1].category
    expect(enemySpecForAsset(spec, air).name).toBe('云哨兵')
    air.enabled = false
    expect(enabledEnemyNamesForLevel(spec, spec.levels[0].id)).toEqual(['风息者'])
  })
})
