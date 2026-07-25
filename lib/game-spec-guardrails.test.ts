import { describe, expect, it } from 'vitest'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { inspectGameSpec } from '@/lib/agents/validation'

describe('GameSpec deterministic guardrails', () => {
  it('turns the Dragon Castle template into compatible five-level assignments', () => {
    const template = PROMPT_TEMPLATES[0]
    const spec = createFallbackGameSpec(template.prompt, template.themeName, template.levelCount)

    expect(spec.levels.map((level) => level.platformMode)).toEqual(['ground', 'ground', 'water', 'air', 'ground'])
    expect(spec.levels.map((level) => level.enemyCount)).toEqual([3, 4, 5, 6, 5])
    expect(spec.levels.filter((level) => level.hasBoss).map((level) => level.id)).toEqual(['level-5'])
    expect(spec.weapon.cooldownMs).toBe(420)

    const waterEnemy = spec.assets.find((asset) => asset.category === 'waterEnemy')
    const groundEnemy = spec.assets.find((asset) => asset.category === 'groundEnemy')
    const airEnemy = spec.assets.find((asset) => asset.category === 'airEnemy')
    expect(waterEnemy?.levelIds).toEqual(['level-3'])
    expect(groundEnemy?.levelIds).toEqual(['level-1', 'level-2', 'level-5'])
    expect(airEnemy?.levelIds).not.toContain('level-3')

    const backgrounds = spec.assets.filter((asset) => asset.category === 'levelBackground')
    expect(backgrounds).toHaveLength(5)
    expect(backgrounds.every((asset) => !/placeholder/i.test(asset.prompt))).toBe(true)
    expect(inspectGameSpec(spec).filter((item) => item.severity === 'blocking')).toEqual([])
  })
})
