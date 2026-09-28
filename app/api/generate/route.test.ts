import { describe, expect, it } from 'vitest'
import { POST } from './route'

describe('POST /api/generate custom endpoint', () => {
  it('rejects a loopback image API before attempting image generation', async () => {
    const request = new Request('http://localhost/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'Test', prompt: 'A pixel star', provider: 'custom', model: 'my-image-model',
        apiKey: 'test-key', customBaseUrl: 'https://127.0.0.1/v1', types: ['collectible'], levelCount: 1 }) })
    const response = await POST(request as never)
    const result = await response.json()
    expect(response.status).toBe(400)
    expect(result.success).toBe(false)
  })
})
