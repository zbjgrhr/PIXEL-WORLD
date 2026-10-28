import { alignNarrativeCast } from '@/lib/narrative'
import { stageNarrativeSuggestions } from '@/lib/narrative-suggestions'
import type { GameSpec } from '@/types'

export interface WebLlmCreativePatch {
  world?: string
  backgroundStory?: string
  artDirection?: string
  palette?: string
  lighting?: string
  heroName?: string
  heroAppearance?: string
  bossName?: string
  bossAppearance?: string
  collectibleName?: string
}

const PATCH_FIELDS = ['world', 'backgroundStory', 'artDirection', 'palette', 'lighting', 'heroName', 'heroAppearance', 'bossName', 'bossAppearance', 'collectibleName'] as const

function cleanText(value: unknown, limit = 700): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, limit) : undefined
}

/** Keep the browser model's input small enough for a 4K context window. */
export function buildWebLlmCreativeRequest(projectName: string, story: string, inspirations: string[]): { system: string; user: string } {
  return {
    system: `You are Pixel World's lightweight creative helper. Return JSON only, with any of these keys: ${PATCH_FIELDS.join(', ')}. Improve the world, hero goal and art direction from the player's story. Do not create levels, assets, code, API settings, or a complete GameSpec. Keep each value concise and preserve the player's intent.`,
    user: [
      `Game title: ${projectName.slice(0, 160)}`,
      `Player story: ${story.length > 700 ? `${story.slice(0, 450)} … ${story.slice(-250)}` : story}`,
      inspirations.length ? `Selected inspirations: ${inspirations.slice(0, 5).map((item) => item.slice(0, 90)).join(' / ')}` : '',
    ].filter(Boolean).join('\n'),
  }
}

/** Conservative estimate used as a preflight guard, not an exact tokenizer. */
export function estimateWebLlmPromptTokens(system: string, user: string): number {
  const text = system + '\n' + user
  const nonAscii = [...text].filter(char => char.charCodeAt(0) > 127).length
  return nonAscii * 2 + Math.ceil((text.length - nonAscii) / 3) + 80
}

export function parseWebLlmCreativePatch(content: string): WebLlmCreativePatch {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('浏览器模型没有返回创意 JSON。')
  const raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
  const patch: WebLlmCreativePatch = {}
  for (const field of PATCH_FIELDS) {
    const text = cleanText(raw[field], field === 'backgroundStory' ? 1200 : 700)
    if (text) patch[field] = text
  }
  if (!Object.keys(patch).length) throw new Error('浏览器模型没有返回可用的创意字段。')
  return patch
}

export function applyWebLlmCreativePatch(spec: GameSpec, patch: WebLlmCreativePatch): GameSpec {
  const unlocked = spec.narrative ? { ...spec.narrative, source: { ...spec.narrative.source, lockedFields: {} } } : undefined
  return stageNarrativeSuggestions(spec, alignNarrativeCast({
    ...spec,
    world: patch.world || spec.world,
    backgroundStory: patch.backgroundStory || spec.backgroundStory,
    narrative: unlocked ? { ...unlocked, opening: patch.backgroundStory || unlocked.opening, source: { ...unlocked.source, origin: 'model' } } : undefined,
    visualStyle: {
      ...spec.visualStyle,
      artDirection: patch.artDirection || spec.visualStyle.artDirection,
      palette: patch.palette || spec.visualStyle.palette,
      lighting: patch.lighting || spec.visualStyle.lighting,
    },
    hero: { ...spec.hero, name: patch.heroName || spec.hero.name, appearance: patch.heroAppearance || spec.hero.appearance },
    boss: { ...spec.boss, name: patch.bossName || spec.boss.name, appearance: patch.bossAppearance || spec.boss.appearance },
    collectible: { ...spec.collectible, name: patch.collectibleName || spec.collectible.name },
  }, spec))
}
