import { describe, expect, it } from 'vitest'
import { createTraversalHints, offlineTraversalHintSource } from './traversal-hints'
import { createGameTranslator } from './game-language'

describe('collision-based traversal guidance', () => {
  it('does not misdiagnose standing still, an open path, or a lethal hazard as a jumpable wall', () => {
    const hints = createTraversalHints()
    hints.observe(100, undefined, true)
    hints.observe(100, 'normalObstacle', false)
    hints.observe(100, 'deathObstacle', true)
    expect(hints.message(100)).toBeNull()
    hints.observe(100, 'normalObstacle', true)
    expect(hints.message(100)).toContain('跳')
    expect(hints.message(2599)).toBeTruthy()
    expect(hints.message(2600)).toBeNull()
  })
  it('clears after a jump or level reset instead of leaving stale advice on screen', () => {
    const hints = createTraversalHints()
    hints.observe(300, 'bounceObstacle', true)
    hints.clear()
    expect(hints.message(301)).toBeNull()
    expect(hints.message(-1)).toBeNull()
    hints.observe(NaN, 'normalObstacle', true)
    expect(hints.message(301)).toBeNull()
  })
  it('runs the same guidance offline and uses the work language for its controls', () => {
    const offline = new Function(offlineTraversalHintSource() + ';return createTraversalHints();')() as ReturnType<typeof createTraversalHints>
    offline.observe(100, 'normalObstacle', true)
    const message = offline.message(100)!
    expect(createGameTranslator('zh-CN')(message)).toBe(message)
    expect(createGameTranslator('en')(message)).toBe('Obstacle ahead. Press W, Space, or ↑ to jump over it, or tap Jump.')
    offline.clear()
    expect(offline.message(101)).toBeNull()
  })
})
