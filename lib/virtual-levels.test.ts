import { describe, expect, it } from 'vitest'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { buildGameDataFromSpec } from '@/lib/virtual-levels'

describe('generated encounter layout', () => {
  it('keeps the required Boss encounter when its image has not been generated', () => {
    const spec = createFallbackGameSpec('小企鹅寻找妈妈，最后击败熊猫Boss。', '寻亲', 3)
    spec.assets = spec.assets.map(asset => asset.category === 'boss' ? { ...asset, url: '', status: 'failed' } : asset)
    const levels = buildGameDataFromSpec(spec).data!.levels
    expect(levels.slice(0, -1).every(level => !level.bossSpawn)).toBe(true)
    expect(levels.at(-1)!.bossSpawn).toEqual(expect.objectContaining({ id: `${spec.levels.at(-1)!.id}-boss`, kind: 'boss' }))
    expect(spec.narrative!.chapters.at(-1)!.objectives.some(task => task.kind === 'boss')).toBe(true)
  })
  it('places instant-death hazards after the ordinary enemy group and outside Boss encounters', () => {
    const spec = createFallbackGameSpec('A short adventure', 'Hazard Layout', 3)
    const levelIds = spec.levels.map(level => level.id)
    spec.assets = spec.assets.filter(asset => ['normalObstacle', 'bounceObstacle', 'deathObstacle'].includes(asset.category))
      .map(asset => ({ ...asset, enabled: true, levelIds, url: 'data:image/png;base64,VEVTVA==' }))
    const levels = buildGameDataFromSpec(spec).data!.levels

    expect(spec.levels[2].hasBoss).toBe(true)
    for (const level of levels.slice(0, 2)) {
      const hazard = level.obstacles.find(obstacle => obstacle.type === 'deathObstacle')
      expect(hazard?.x).toBe(810)
      expect(hazard!.x).toBeGreaterThan(Math.max(...level.enemySpawns.map(enemy => enemy.x)))
    }
    expect(levels[2].obstacles.some(obstacle => obstacle.type === 'deathObstacle')).toBe(false)
    expect(levels[2].obstacles.length).toBeGreaterThan(0)
  })
})
