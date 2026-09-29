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

  it('locks the player title and story into the optimized specification', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: buildStructuredPrompt(2),
        theme: '史莱姆王国：勇士沙恶龙救公主',
        story: '公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。',
        levelCount: 2,
        provider: 'cloudflare',
      }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.data.spec.title).toBe('史莱姆王国：勇士沙恶龙救公主')
    expect(data.data.spec.world).toContain('公主被恶龙')
    expect(data.data.spec.backgroundStory).toBe('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
  })

  it('uses the player story even when other structured fields are filled', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: buildStructuredPrompt(3)
          .replace('整体像素风格：', '整体像素风格：明亮的 16-bit 像素风')
          .replace('主角 / Hero：', '主角 / Hero：穿蓝披风的骑士'),
        theme: '星光救援',
        story: '公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。',
        levelCount: 3,
        provider: 'cloudflare',
      }),
    })

    const response = await POST(request as never)
    const data = await response.json()
    const spec = data.data.spec
    expect(spec.title).toBe('星光救援')
    expect(spec.world).toContain('公主被恶龙带到火山城堡')
    expect(spec.backgroundStory).toBe('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
    expect(spec.hero.name).toBe('年轻勇士')
    expect(spec.hero.appearance).toContain('穿蓝披风的骑士')
    expect(spec.boss.name).toBe('恶龙')
    expect(spec.collectible.name).toBe('星光钥匙')
    expect(spec.levels.at(-1).environment).toContain('火山城堡')
    expect(spec.assets.find((asset: { category: string }) => asset.category === 'levelBackground').prompt).toContain('火山城堡')
  })
})
