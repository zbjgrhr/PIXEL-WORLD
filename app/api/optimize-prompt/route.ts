import { NextRequest, NextResponse } from 'next/server'
import {
  createFallbackGameSpec,
  normalizeGameSpec,
  serializeGameSpec,
} from '@/lib/game-spec'
import type { GameSpec, ProviderId } from '@/types'

interface OptimizeRequest {
  prompt?: string
  theme?: string
  levelCount?: number
  provider?: ProviderId
  apiKey?: string
}

const SYSTEM_PROMPT = `You are a game-design prompt compiler. Convert the user's idea into one strict JSON GameSpec for a playable 2D side-scrolling pixel platform combat game.

Rules:
- Keep background, hero, enemy, weapon, ground, obstacle, projectile, attack effect, collectible, and boss visually separate.
- Asset descriptions must state only what belongs to that asset; never copy a whole scene into a sprite description.
- Preserve the user's theme and important creative choices.
- Produce coherent art direction, palette, lighting, and pixel scale shared by all assets.
- Write backgroundStory as a vivid 120-180 word game introduction with a clear conflict, the hero's goal, the collectible's importance, and the final boss. Do not describe UI or controls.
- Every game includes melee and ranged combat, ordinary enemies, collectibles, projectiles, attack effects, and a final boss.
- The final level hasBoss=true; earlier levels haveBoss=false.
- Return JSON only, without markdown.`

function optimizerEndpoint(provider: ProviderId): { url: string; model: string; envKey: string } {
  if (provider === 'openai') {
    return { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' }
  }
  if (provider === 'openrouter') {
    return { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', envKey: 'OPENROUTER_API_KEY' }
  }
  return {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    envKey: 'DASHSCOPE_API_KEY',
  }
}

function extractJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Optimizer returned no JSON object')
  return JSON.parse(cleaned.slice(start, end + 1))
}

async function optimizeWithAi(
  provider: ProviderId,
  apiKey: string,
  prompt: string,
  fallback: GameSpec,
): Promise<unknown> {
  const config = optimizerEndpoint(provider)
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter' ? {
        'HTTP-Referer': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
        'X-Title': 'Prompt-to-Play Pixel World',
      } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.25,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Requested level count: ${fallback.levels.length}\nFallback schema example (keep these exact keys):\n${JSON.stringify(fallback)}\n\nUser idea:\n${prompt}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Prompt optimizer API failed (${response.status}): ${detail.slice(0, 180)}`)
  }

  const payload = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('Prompt optimizer returned an empty response')
  return extractJson(content)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as OptimizeRequest
    const prompt = body.prompt?.trim() || ''
    const theme = body.theme?.trim() || 'Pixel World'
    const levelCount = Math.min(10, Math.max(1, body.levelCount || 3))

    if (!prompt) {
      return NextResponse.json({ success: false, error: 'Please enter a game idea first.' }, { status: 400 })
    }

    const fallback = createFallbackGameSpec(prompt, theme, levelCount)
    const provider = body.provider || 'dashscope'
    const config = optimizerEndpoint(provider)
    const apiKey = body.apiKey?.trim() || process.env[config.envKey]?.trim() || ''

    let spec = fallback
    let source: 'ai' | 'local' = 'local'
    let warning: string | undefined

    if (apiKey) {
      try {
        const candidate = await optimizeWithAi(provider, apiKey, prompt, fallback)
        spec = normalizeGameSpec(candidate, fallback, levelCount)
        source = 'ai'
      } catch (error) {
        warning = error instanceof Error
          ? `AI optimization was unavailable, so the reliable local compiler was used: ${error.message}`
          : 'AI optimization was unavailable, so the reliable local compiler was used.'
      }
    } else {
      warning = 'No API key was supplied for text optimization; the local structured compiler was used.'
    }

    return NextResponse.json({
      success: true,
      data: {
        spec,
        optimizedPrompt: serializeGameSpec(spec),
        source,
        warning,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Prompt optimization failed.' },
      { status: 500 },
    )
  }
}
