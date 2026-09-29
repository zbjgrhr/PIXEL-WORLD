import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { buildBuiltinGameSpec } from '@/lib/builtin-game'
import { createFallbackGameSpec } from '@/lib/game-spec'
import { buildGameDataFromSpec } from '@/lib/virtual-levels'

describe('zero-key built-in game', () => {
  it('bundles every enabled visual asset and produces playable level data', () => {
    const compiled = createFallbackGameSpec('A forest adventure', 'Forest Test', 3)
    const spec = buildBuiltinGameSpec(compiled)
    const enabledVisuals = spec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet'))
    expect(enabledVisuals.length).toBeGreaterThan(10)
    for (const asset of enabledVisuals) {
      expect(asset.url, asset.id).toMatch(/^\/builtin\/[a-z-]+\.svg$/)
      expect(existsSync(join(process.cwd(), 'public', asset.url!.slice(1))), asset.id).toBe(true)
    }
    const game = buildGameDataFromSpec(spec)
    expect(game.data?.levels).toHaveLength(3)
    expect(game.data?.characterUrl).toMatch(/^\/builtin\//)
    expect(game.data?.bossUrl).toMatch(/^\/builtin\//)
  })
})
