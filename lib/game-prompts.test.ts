import { describe, expect, it } from 'vitest'
import { buildAnimationClipPrompt, buildPlannedAssetPrompt, getNegativeTemplate, getPositiveTemplate } from '@/lib/game-prompts'
import { createFallbackGameSpec } from '@/lib/game-spec'

describe('game image color contract', () => {
  it('requests vivid readable backgrounds and rejects gray grading', () => {
    const positive = getPositiveTemplate('background', 'openrouter', 'test-model')
    const negative = getNegativeTemplate('background', 'openrouter', 'test-model')

    expect(positive).toMatch(/bright high-saturation color harmony/i)
    expect(positive).toMatch(/sharp pixel detail/i)
    expect(negative).toMatch(/desaturated gray wash/i)
    expect(negative).toMatch(/muddy palette/i)
  })
})

describe('action prompt identity', () => {
  it('removes full-sheet instructions from an idle clip request', () => {
    const spec = createFallbackGameSpec('邮差，风，失踪的信。', '云中邮差', 3)
    const original = spec.assets.find(asset => asset.category === 'hero')!
    const asset = { ...original, prompt: 'Pixel-art side-view sprite sheet: red raincoat courier. All 8 animation states (idle/walk/jump/meleeAttack/rangedAttack/hit/death) show identical outfit and full body.' }
    const prompt = buildAnimationClipPrompt(asset, 'idle', spec.title, spec, 'openrouter', 'bytedance-seed/seedream-5-0-flash')
    expect(prompt).toContain('exactly one frame')
    expect(prompt).toContain('red raincoat courier')
    expect(prompt).not.toMatch(/All 8 animation states/i)
    expect(prompt).not.toMatch(/sprite sheet/i)
  })

  it('asks for distinct contact and passing poses in a walking strip', () => {
    const spec = createFallbackGameSpec('邮差，风，失踪的信。', '云中邮差', 3)
    const hero = spec.assets.find(asset => asset.category === 'hero')!
    const prompt = buildAnimationClipPrompt(hero, 'walk', spec.title, spec, 'openrouter', 'bytedance-seed/seedream-5-0-flash')
    expect(prompt).toContain('high passing pose')
    expect(prompt).toContain('opposite contact stride')
    expect(prompt).toContain('separated leg silhouettes')
  })
})

describe('separate background and playable ground', () => {
  it('puts bridges in distant scenery instead of the walkable action plane', () => {
    const spec = createFallbackGameSpec('断裂浮桥上的邮差', '云中邮差', 3)
    const original = spec.assets.find(asset => asset.category === 'levelBackground')!
    const asset = { ...original, prompt: 'Broken floating bridge and wind-bell towers. Wide readable traversal lane.' }
    const prompt = buildPlannedAssetPrompt(asset, 'background', spec.title, spec, 0, 'openrouter', 'bytedance-seed/seedream-5-0-flash')
    expect(prompt).toMatch(/backdrop layer/i)
    expect(prompt).toMatch(/bridges and towers far behind/i)
    expect(prompt).toMatch(/separate horizontal ground layer/i)
    expect(prompt).not.toMatch(/Wide readable traversal lane/i)
  })
})
