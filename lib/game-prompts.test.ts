import { describe, expect, it } from 'vitest'
import { getNegativeTemplate, getPositiveTemplate } from '@/lib/game-prompts'

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
