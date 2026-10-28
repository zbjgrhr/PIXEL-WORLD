import { NextRequest, NextResponse } from 'next/server'
import {
  createFallbackGameSpec,
  serializeGameSpec,
} from '@/lib/game-spec'
import type { GameSpec, ProviderId } from '@/types'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { apiKeyHasUnsupportedCharacters, normalizeApiKey } from '@/lib/api-key'
import { isStructuredPromptBlank } from '@/lib/asset-catalog'
import { mergeProjectBrief } from '@/lib/project-brief'
import { normalizeModelGameSpec } from '@/lib/model-game-spec'
import { responseText, type ChatPayload } from '@/lib/agents/execution'
import { separateStoryIntroduction } from '@/lib/story-introduction'

interface OptimizeRequest {
  prompt?: string
  theme?: string
  story?: string
  levelCount?: number
  provider?: ProviderId
  model?: string
  apiKey?: string
}

const SYSTEM_PROMPT = `You help a player turn a game idea into a coherent 2D pixel adventure. Return one concise JSON object, using only fields you can improve: world, backgroundStory, hero {name, appearance}, boss {name, appearance}, collectible {name}, visualStyle {artDirection, palette, lighting}, narrative {incitingIncident, motivation, conflict, bossRelation, opening, ending}. Write player-facing story in natural Chinese. The player's name, story, explicitly named characters, place, relationships and outcome are facts; never replace them. If the story already has a completed ending, do not rewrite its opening or ending; propose at most two genuinely useful narrative improvements, preferably a missing cause or boss relationship. Omit unchanged fields. Enrich missing motives and visual identity without inventing unsupported game mechanics. Image appearance describes one isolated, consistent character. Do not return levels, assets, audio, rules, a complete GameSpec or markdown. Keep the whole answer short.`

const OPTIMIZER_TIMEOUT_MS = 60_000
// Leave room for a short reasoning pass and a complete JSON patch, while still
// bounding cost and latency. Full GameSpec generation belongs to the Agents.
const OPTIMIZER_OUTPUT_TOKENS = 4000

function compactStory(story: string): string {
  const value = story.trim()
  return value.length <= 1800 ? value : `${value.slice(0, 1050)}\n…\n${value.slice(-650)}`
}

function compactPlayerFields(prompt: string): string {
  return prompt.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(/^([^：:]{1,70})[：:]\s*(.+)$/)
    if (!match || /^(?:游戏标题|世界观与故事|背景故事)$/.test(match[1].trim())) return []
    return [`${match[1].trim()}：${match[2].trim().slice(0, 200)}`]
  }).slice(0, 30).join('\n').slice(0, 3000)
}

export function optimizerMessages(prompt: string, fallback: GameSpec): Array<{ role: 'system' | 'user'; content: string }> {
  const story = fallback.narrative?.source.originalStory.split('【已选灵感】')[0].trim() || ''
  const inspirations = [...prompt.matchAll(/【已选灵感】([^\n]+)/g)].map(match => match[1].trim()).slice(0, 5)
  const fields = compactPlayerFields(prompt)
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: [
      `游戏名称：${fallback.title.slice(0, 160)}`,
      `玩家故事：${compactStory(story)}`,
      inspirations.length ? `已选灵感：${inspirations.join('；').slice(0, 600)}` : '',
      fields ? `玩家已填要求：\n${fields}` : '',
      `当前草案事实：主角=${fallback.hero.name}；Boss=${fallback.boss.name}；地点=${fallback.world.slice(0, 180)}；目标=${fallback.creativeBrief?.heroGoal || fallback.narrative?.motivation || ''}`,
    ].filter(Boolean).join('\n') },
  ]
}

function optimizerEndpoint(provider: ProviderId): { url: string; model: string } | undefined {
  if (provider === 'openai') {
    return { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' }
  }
  if (provider === 'openrouter') {
    return { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free' }
  }
  if (provider === 'dashscope') return {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
  }
  return undefined
}

function extractJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Optimizer returned no JSON object')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/** Keep one-click completion focused; the full Agent review can propose wider rewrites. */
export function curateOptimizerCandidate(value: unknown, fallback: GameSpec): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const candidate = { ...(value as Record<string, unknown>) }
  const story = fallback.narrative?.source.originalStory.split('【已选灵感】')[0] || ''
  const hasPlayerEnding = Boolean(separateStoryIntroduction(story).ending)
  if (hasPlayerEnding) delete candidate.backgroundStory
  if (candidate.narrative && typeof candidate.narrative === 'object' && !Array.isArray(candidate.narrative)) {
    const proposed = candidate.narrative as Record<string, unknown>
    const allowed = hasPlayerEnding
      ? ['incitingIncident', 'bossRelation', 'conflict', 'motivation']
      : ['incitingIncident', 'motivation', 'bossRelation', 'conflict', 'opening', 'ending']
    candidate.narrative = Object.fromEntries(allowed.filter(key => typeof proposed[key] === 'string' && String(proposed[key]).trim()).slice(0, hasPlayerEnding ? 2 : 4).map(key => [key, proposed[key]]))
  }
  return candidate
}

async function optimizeWithAi(
  provider: ProviderId,
  apiKey: string,
  prompt: string,
  fallback: GameSpec,
  selectedModel?: string,
): Promise<unknown> {
  const config = optimizerEndpoint(provider)
  if (!config) throw new Error('当前文字服务不提供兼容的提示词整理接口')
  const response = await fetch(config.url, {
    method: 'POST',
    signal: AbortSignal.timeout(OPTIMIZER_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(provider === 'openrouter' ? {
        'HTTP-Referer': process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000',
        'X-Title': 'Prompt-to-Play Pixel World',
      } : {}),
    },
    body: JSON.stringify({
      model: selectedModel?.trim() || config.model,
      temperature: 0.25,
      max_tokens: OPTIMIZER_OUTPUT_TOKENS,
      ...(provider === 'openrouter' && selectedModel?.trim() === 'qwen/qwen3.8-flash'
        ? { reasoning: { effort: 'low' } }
        : {}),
      response_format: { type: 'json_object' },
      messages: optimizerMessages(prompt, fallback),
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Prompt optimizer API failed (${response.status}): ${detail.slice(0, 180)}`)
  }

  const payload = await response.json() as ChatPayload
  const content = responseText(payload)
  if (!content) throw new Error('Prompt optimizer returned an empty response')
  return curateOptimizerCandidate(extractJson(content), fallback)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as OptimizeRequest
    const theme = body.theme?.trim() || 'Pixel World'
    const story = body.story?.trim().slice(0, 12000) || ''
    const levelCount = Math.min(10, Math.max(1, body.levelCount || 3))
    const submittedPrompt = body.prompt?.trim() || ''
    const basePrompt = isStructuredPromptBlank(submittedPrompt)
      ? story ? '' : `Create an original colorful ${levelCount}-level pixel platform adventure. Fill every required GameSpec V3 field with a coherent hero, melee and ranged combat, enemies, collectibles, distinct level environments, and a final boss. Keep every visual asset isolated and game-ready.`
      : submittedPrompt
    const prompt = mergeProjectBrief(basePrompt, body.theme?.trim() || '', story)

    const fallback = createFallbackGameSpec(prompt, theme, levelCount)
    const provider = body.provider || 'dashscope'
    const config = optimizerEndpoint(provider)
    const apiKey = config
      ? normalizeApiKey(body.apiKey?.trim() || '')
      : ''
    if (apiKeyHasUnsupportedCharacters(apiKey)) {
      return NextResponse.json(
        { success: false, error: 'API Key contains unsupported characters. Clear the field and paste only the key from the provider dashboard.' },
        { status: 400 },
      )
    }

    let spec = fallback
    let source: 'ai' | 'local' | 'template' = 'local'
    let warning: string | undefined
    const knownTemplate = PROMPT_TEMPLATES.find((template) => template.prompt.trim() === submittedPrompt)

    if (knownTemplate) {
      // The bundled template is already exhaustive and category-safe. Keeping it
      // deterministic avoids a free text model swapping hero/weapon/enemy fields.
      spec = fallback
      source = 'template'
    } else if (apiKey && config) {
      try {
        const candidate = await optimizeWithAi(provider, apiKey, prompt, fallback, body.model)
        spec = normalizeModelGameSpec(candidate, fallback, levelCount, prompt)
        source = 'ai'
      } catch (error) {
        warning = error instanceof Error && /TimeoutError|AbortError/.test(error.name)
          ? '文字模型在 60 秒内未完成补全，已保留可审核的本地草案。你可以继续制作，或换模型后重试。'
          : error instanceof Error
            ? `文字模型补全未完成，已保留可审核的本地草案：${error.message.slice(0, 180)}`
            : '文字模型补全未完成，已保留可审核的本地草案。'
      }
    } else {
      warning = config && !apiKey
        ? '所选文字服务尚未填写 API Key，已生成可审核的本地草案。填写 Key 后可重新补全。'
        : '已在本地整理游戏构想；选择文字 Agent 并运行后，会继续策划和评审。'
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
