import { describe, expect, it } from 'vitest'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { inspectGameSpec } from './validation'

describe('Agent GameSpec validation', () => {
  it('accepts the complete Dragon Castle five-level template without blocking omissions', () => {
    const template = PROMPT_TEMPLATES.find((item) => item.id === 'pixel-world-odyssey') || PROMPT_TEMPLATES[0]
    const spec = createFallbackGameSpec(template.prompt, template.themeName, template.levelCount)
    expect(spec.version).toBe(3)
    expect(spec.levels).toHaveLength(5)
    expect(inspectGameSpec(spec).filter((issue) => issue.severity === 'blocking')).toEqual([])
  })

  it('finds missing ranged combat, boss and backgrounds with field paths', () => {
    const spec = createFallbackGameSpec('A small original pixel platform game.', 'Minimal Test', 2)
    spec.assets = spec.assets.filter((asset) => !['rangedWeapon', 'rangedProjectile', 'boss', 'levelBackground'].includes(asset.category))
    spec.levels = spec.levels.map((level, index) => ({ ...level, hasBoss: false, enemyCount: index ? 1 : level.enemyCount }))
    const issues = inspectGameSpec(spec)
    expect(issues.some((issue) => issue.path === 'assets.rangedWeapon' && issue.severity === 'blocking')).toBe(true)
    expect(issues.some((issue) => issue.path === 'levels.last.hasBoss' && issue.severity === 'blocking')).toBe(true)
    expect(issues.some((issue) => issue.path === 'levels.0.background')).toBe(true)
  })
})
