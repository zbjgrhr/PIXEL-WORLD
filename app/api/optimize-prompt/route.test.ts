import { describe, expect, it } from 'vitest'
import { POST } from './route'
import { buildStructuredPrompt } from '@/lib/asset-catalog'

describe('POST /api/optimize-prompt', () => {
  it('builds a complete local GameSpec when the player leaves the prompt empty', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', theme: '', levelCount: 2, provider: 'cloudflare' }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.source).toBe('local')
    expect(data.data.spec.levels).toHaveLength(2)
    expect(data.data.spec.assets.length).toBeGreaterThan(0)
    expect(data.data.optimizedPrompt.length).toBeGreaterThan(100)
  })

  it('treats the untouched structured field skeleton as empty input', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildStructuredPrompt(2), theme: '', levelCount: 2, provider: 'cloudflare' }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.spec.levels).toHaveLength(2)
    expect(data.data.spec.world).not.toContain('观与故事：')
    expect(data.data.spec.backgroundStory).not.toContain('整体像素风格：')
    expect(data.data.optimizedPrompt).not.toContain('世界观与故事：观与故事：')
  })
})
