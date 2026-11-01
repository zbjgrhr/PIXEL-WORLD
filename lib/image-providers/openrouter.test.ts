import { describe, expect, it } from 'vitest'
import { getAspectRatio } from './openrouter'

describe('OpenRouter animation image ratio', () => {
  it('uses the widest documented Seedream ratios for two and three frames', () => {
    const model = 'bytedance-seed/seedream-5-0-flash'
    expect(getAspectRatio('character', 'animation-strip', 3, model)).toBe('21:9')
    expect(getAspectRatio('character', 'animation-strip', 2, model)).toBe('2:1')
    expect(getAspectRatio('background', 'single', 1, model)).toBe('16:9')
  })
})
