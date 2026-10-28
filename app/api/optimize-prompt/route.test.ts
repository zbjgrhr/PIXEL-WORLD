import { describe, expect, it, vi } from 'vitest'
import { POST, curateOptimizerCandidate, optimizerMessages } from './route'
import { buildStructuredPrompt } from '@/lib/asset-catalog'
import { createFallbackGameSpec } from '@/lib/game-spec'

describe('POST /api/optimize-prompt', () => {
  it('explains a missing key for the selected cloud model and keeps the local draft', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: '寻亲', story: '小企鹅在日本寻找妈妈。', provider: 'dashscope', model: 'qwen-plus', levelCount: 2 }),
    })
    const data = await (await POST(request as never)).json()
    expect(data.data.source).toBe('local')
    expect(data.data.spec.hero.name).toBe('小企鹅')
    expect(data.data.warning).toContain('API Key')
  })
  it('limits one-click edits when the player already supplied an ending', () => {
    const base = createFallbackGameSpec('世界观与故事：小企鹅在日本世界打败熊猫Boss，最后找到了妈妈。', '小企鹅找妈妈', 2)
    const candidate = curateOptimizerCandidate({
      backgroundStory: '模型重写了整个故事。',
      narrative: { opening: '模型重写开场。', ending: '模型换掉结局。', motivation: '小企鹅想找到妈妈。', conflict: '熊猫守住终点。', incitingIncident: '妈妈失踪了。', bossRelation: '熊猫挡在寻找妈妈的路上。' },
    }, base) as Record<string, unknown>
    expect(candidate.backgroundStory).toBeUndefined()
    expect(Object.keys(candidate.narrative as object)).toEqual(['incitingIncident', 'bossRelation'])
  })
  it('asks cloud text models for a bounded creative patch and merges it with the complete local draft', async () => {
    const fallback = createFallbackGameSpec('世界观与故事：邮差在暴风雨中寻找失踪的信件。', '风中的信', 3)
    const messages = optimizerMessages('世界观与故事：邮差在暴风雨中寻找失踪的信件。', fallback)
    expect(JSON.stringify(messages)).not.toContain('"assets"')
    expect(JSON.stringify(messages).length).toBeLessThan(7000)
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ world: '暴风雨笼罩的风铃邮路。', narrative: { incitingIncident: '狂风吹散了信件。' } }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    try {
      const request = new Request('http://localhost/api/optimize-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '', theme: '风中的信', story: '邮差在暴风雨中寻找失踪的信件。', levelCount: 3, provider: 'dashscope', model: 'qwen-max', apiKey: 'test-key' }),
      })
      const response = await POST(request as never)
      const data = await response.json()
      expect(data.data.source).toBe('ai')
      expect(data.data.spec.levels).toHaveLength(3)
      expect(data.data.spec.assets.length).toBeGreaterThan(0)
      expect(data.data.spec.narrative.incitingIncident).toBe('狂风吹散了信件。')
      const init = fetchMock.mock.calls[0][1]!
      expect(init.signal).toBeDefined()
      const sent = JSON.parse(String(init.body))
      expect(sent.max_tokens).toBe(4000)
      expect(sent.model).toBe('qwen-max')
      expect(JSON.stringify(sent.messages)).not.toContain('"assets"')
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('allows Qwen Flash a short reasoning pass and still reserves room for the JSON patch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ narrative: { incitingIncident: '小企鹅发现了妈妈留下的线索。' } }) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    try {
      const response = await POST(new Request('http://localhost/api/optimize-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: '小企鹅找妈妈', story: '小企鹅在日本世界打败各种怪物和熊猫 Boss，最后找到妈妈。', levelCount: 3, provider: 'openrouter', model: 'qwen/qwen3.8-flash', apiKey: 'test-key' }),
      }) as never)
      const result = await response.json()
      const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
      expect(sent.reasoning).toEqual({ effort: 'low' })
      expect(sent.max_tokens).toBe(4000)
      expect(result.data.source).toBe('ai')
      expect(result.data.spec.hero.name).toBe('小企鹅')
      expect(result.data.spec.boss.name).toBe('熊猫')
      expect(result.data.spec.narrative.source.originalStory).toBe('小企鹅在日本世界打败各种怪物和熊猫 Boss，最后找到妈妈。')
    } finally {
      fetchMock.mockRestore()
    }
  })
  it('keeps a usable local draft when the cloud request times out', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'))
    try {
      const request = new Request('http://localhost/api/optimize-prompt', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: '', theme: '风中的信', story: '邮差在暴风雨中寻找失踪的信件。', levelCount: 2, provider: 'dashscope', apiKey: 'test-key' }),
      })
      const response = await POST(request as never)
      const data = await response.json()
      expect(response.status).toBe(200)
      expect(data.data.source).toBe('local')
      expect(data.data.spec.levels).toHaveLength(2)
      expect(data.data.warning).toContain('60 秒')
      expect(data.data.warning).toContain('本地草案')
    } finally {
      fetchMock.mockRestore()
    }
  })
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
    expect(data.data.spec.backgroundStory).toContain('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
    expect(data.data.spec.narrative.source.originalStory).toBe('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
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
    expect(spec.backgroundStory).toContain('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
    expect(spec.narrative.source.originalStory).toBe('公主被恶龙带到火山城堡，年轻勇士必须收集两枚星光钥匙后救出她。')
    expect(spec.hero.name).toBe('年轻勇士')
    expect(spec.hero.appearance).toContain('穿蓝披风的骑士')
    expect(spec.boss.name).toBe('恶龙')
    expect(spec.collectible.name).toBe('星光钥匙')
    expect(spec.levels.at(-1).environment).toContain('火山城堡')
    expect(spec.assets.find((asset: { category: string }) => asset.category === 'levelBackground').prompt).toContain('火山城堡')
  })

  it('keeps a short player synopsis instead of replacing its hero and world with the default castle', async () => {
    const story = '小企鹅在日本世界打败所有怪物和熊猫Boss，最后找到了自己的妈妈。'
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: buildStructuredPrompt(2), theme: '小企鹅找妈妈', story, levelCount: 2, provider: 'cloudflare' }),
    })
    const response = await POST(request as never)
    const data = await response.json()
    const spec = data.data.spec
    expect(spec.hero.name).toBe('小企鹅')
    expect(spec.hero.appearance).toContain('小企鹅')
    expect(spec.hero.appearance).not.toContain('骑士')
    expect(spec.boss.name).toBe('熊猫')
    expect(spec.world).toContain('日本世界')
    expect(spec.world).not.toContain('曙光城堡')
    expect(spec.world).not.toContain('最后找到了')
    expect(spec.weapon.name).not.toContain('曙光')
    expect(spec.enemies[0].name).toBe('灯笼小妖')
    expect(spec.enemies[0].appearance).toContain('lantern spirit')
    expect(spec.levels[0].name).toBe('日本世界的海边村庄')
    expect(spec.levels[0].environment).toContain('海边村庄')
    expect(spec.levels.at(-1).name).toBe('日本世界的竹林深处')
    expect(spec.narrative.chapters[0].points[0].name).not.toMatch(/航路|终端/)
    expect(spec.narrative.source.originalStory).toBe(story)
    expect(spec.narrative.opening).not.toMatch(/打败[^。]*熊猫Boss/)
    expect(spec.narrative.opening).not.toContain('最后找到了自己的妈妈')
    expect(spec.narrative.ending).toContain('妈妈')
    expect(spec.narrative.ending).toContain('小企鹅击败熊猫')
  })

  it('keeps a desert location and animal hero through the local specification', async () => {
    const story = '小狐狸在埃及沙漠寻找失踪的妹妹，最后打败蝎子Boss救出了她。'
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', theme: '沙漠寻亲', story, levelCount: 3, provider: 'cloudflare' }),
    })
    const response = await POST(request as never)
    const data = await response.json()
    const spec = data.data.spec
    expect(spec.world).toContain('埃及沙漠')
    expect(spec.world).not.toContain('曙光城堡')
    expect(spec.hero.name).toBe('小狐狸')
    expect(spec.hero.appearance).toContain('蓬松尾巴')
    expect(spec.hero.appearance).not.toContain('骑士')
    expect(spec.boss.name).toBe('蝎子')
    expect(spec.enemies[0].name).toBe('沙漠甲虫')
    expect(spec.enemies[0].appearance).toContain('desert beetle')
    expect(spec.weapon.name).not.toContain('曙光')
    expect(spec.levels[0].name).toContain('绿洲营地')
    expect(spec.levels.at(-1).name).toContain('蝎巢深处')
    expect(spec.assets.find((asset: { category: string }) => asset.category === 'levelBackground').prompt).toContain('绿洲营地')
    expect(spec.narrative.clues[0].setup).toContain('妹妹')
    expect(spec.narrative.source.originalStory).toBe(story)
    expect(spec.narrative.opening).not.toContain('救出了她')
    expect(spec.narrative.ending).toBe('小狐狸终于打败蝎子救出了妹妹。')
  })

  it('does not replace a moon story with castle characters or scenery', async () => {
    const story = '小猫在月球寻找失落的星星，最后战胜陨石Boss带星星回家。'
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', theme: '月球寻星', story, levelCount: 3, provider: 'cloudflare' }),
    })
    const data = await (await POST(request as never)).json()
    const spec = data.data.spec
    expect(spec.world).toContain('月球')
    expect(spec.hero.name).toBe('小猫')
    expect(spec.hero.appearance).toContain('三角耳朵')
    expect(spec.hero.appearance).not.toContain('骑士')
    expect(spec.boss.name).toBe('陨石')
    expect(spec.enemies[0].name).toBe('月尘怪')
    expect(spec.levels[0].name).toBe('月球着陆区')
    expect(spec.levels.at(-1).name).toBe('陨石坑深处')
    expect(spec.narrative.opening).not.toContain('小猫来到月球，前往目标')
    expect(spec.narrative.opening).not.toContain('小猫决定寻找失落的星星')
    expect(spec.narrative.clues[0].setup).toContain('月岩')
    expect(spec.narrative.opening).not.toContain('带星星回家')
    expect(spec.narrative.ending).toContain('小猫终于战胜陨石')
  })

  it('turns a few keywords into an introduction without repeating the raw list', async () => {
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', theme: '风中的信', story: '邮差，风，失踪的信。', levelCount: 3, provider: 'cloudflare' }),
    })
    const data = await (await POST(request as never)).json()
    expect(data.data.spec.narrative.opening).not.toContain('邮差，风，失踪的信')
    expect(data.data.spec.narrative.opening).toContain('邮差小禾')
    expect(data.data.spec.narrative.source.originalStory).toBe('邮差，风，失踪的信。')
  })

  it('keeps the specific conflict and completed outcome of a full story', async () => {
    const story = '艾岚是一名失去听力的钟表匠，穿灰色工装，带着妹妹留下的黄铜怀表。城里的钟突然停了，妹妹失踪。艾岚追查旧钟楼，发现报时核心把居民困在城中。他修好核心，找到妹妹，兄妹在恢复钟声的广场重逢。'
    const request = new Request('http://localhost/api/optimize-prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', theme: '钟坊归途', story, levelCount: 3, provider: 'cloudflare' }),
    })
    const data = await (await POST(request as never)).json()
    const spec = data.data.spec
    expect(spec.hero.name).toBe('艾岚')
    expect(spec.hero.appearance).toContain('失去听力的钟表匠')
    expect(spec.world).toContain('城里的钟突然停了')
    expect(spec.world).not.toContain('广场重逢')
    expect(spec.narrative.opening).not.toContain('广场重逢')
    expect(spec.narrative.ending).toContain('艾岚修好核心')
    expect(spec.narrative.ending).toContain('广场重逢')
    expect(spec.narrative.source.originalStory).toBe(story)
  })
})
