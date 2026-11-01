import { describe, expect, it } from 'vitest'
import { validSpriteClipGeometry } from './sprite-clip-browser'

describe('sprite clip geometry', () => {
  it('rejects the square round-03 pictures falsely marked as three-frame clips', () => {
    expect(validSpriteClipGeometry(1026, 1024, 3)).toBe(false)
    expect(validSpriteClipGeometry(1024, 1024, 2)).toBe(false)
  })
  it('accepts aligned square cells in one horizontal row', () => {
    expect(validSpriteClipGeometry(1536, 512, 3)).toBe(true)
    expect(validSpriteClipGeometry(1024, 512, 2)).toBe(true)
    expect(validSpriteClipGeometry(1024, 1024, 1)).toBe(true)
  })
})
