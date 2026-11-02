/** A bounded, data-only format, independent of the existing 2D GameSpec V3. */
export interface SpatialProject {
  schema: 'pixel-world/spatial'
  version: 1
  title: string
  brief: string
  genre: 'exploration' | 'rhythm'
  environment: 'forest' | 'desert' | 'night' | 'snow'
  seed: number
  arenaSize: number
  goalCount: number
  decorationCount: number
  playerSpeed: number
  rhythm: {
    bpm: number; bars: number; offsetMs: number
    chartVersion?: 1 | 2
    difficulty?: 'relaxed' | 'normal' | 'hard'
    feedback?: { effects: number; hitVolume: number; musicVolume: number; shake: boolean }
  }
}

export const SPATIAL_ENVIRONMENTS = {
  forest: '薄荷森林', desert: '日落沙丘', night: '星夜遗迹', snow: '雪原微光',
} as const

export class SpatialSpecError extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SpatialSpecError('项目必须是 JSON 对象。')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new SpatialSpecError(`${field}必须填写，且不能超过 ${maximum} 个字符。`)
  return value.trim()
}

function number(value: unknown, field: string, minimum: number, maximum: number, integer = true): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new SpatialSpecError(`${field}必须是 ${minimum}–${maximum} 之间的${integer ? '整数' : '数字'}。`)
  }
  return value
}

/** Pick only supported fields. Model output never becomes executable code or asset URLs. */
export function parseSpatialProject(value: unknown): SpatialProject {
  const p = record(value)
  if (p.schema !== 'pixel-world/spatial' || p.version !== 1) throw new SpatialSpecError('这不是 Spatial V1 项目；原有 2D 项目请在 2D 制作台打开。')
  if (p.genre !== 'exploration' && p.genre !== 'rhythm') throw new SpatialSpecError('当前支持收集探索与节奏击打两种模板。')
  if (!Object.hasOwn(SPATIAL_ENVIRONMENTS, String(p.environment))) throw new SpatialSpecError('请选择有效的场景环境。')
  const rhythm = record(p.rhythm)
  if (rhythm.chartVersion !== undefined && rhythm.chartVersion !== 1 && rhythm.chartVersion !== 2) throw new SpatialSpecError('不支持的音符编排版本。')
  if (rhythm.difficulty !== undefined && !['relaxed', 'normal', 'hard'].includes(String(rhythm.difficulty))) throw new SpatialSpecError('不支持的演奏难度。')
  let feedback: SpatialProject['rhythm']['feedback']
  if (rhythm.feedback !== undefined) {
    const f = record(rhythm.feedback)
    if (typeof f.shake !== 'boolean') throw new SpatialSpecError('镜头震动开关无效。')
    feedback = { effects: number(f.effects, '视觉反馈', 0, 1, false), hitVolume: number(f.hitVolume, '打击音量', 0, 1, false), musicVolume: number(f.musicVolume, '音乐音量', 0, 1, false), shake: f.shake }
  }
  return {
    schema: 'pixel-world/spatial', version: 1,
    title: text(p.title, '标题', 80), brief: text(p.brief, '构想', 4000),
    genre: p.genre, environment: p.environment as SpatialProject['environment'],
    seed: number(p.seed, '随机种子', 1, 2147483647),
    arenaSize: number(p.arenaSize, '场景大小', 20, 48),
    goalCount: number(p.goalCount, '收集数量', 3, 12),
    decorationCount: number(p.decorationCount, '景物数量', 8, 48),
    playerSpeed: number(p.playerSpeed, '移动速度', 1, 3, false),
    rhythm: {
      bpm: number(rhythm.bpm, 'BPM', 60, 160), bars: number(rhythm.bars, '小节数', 4, 16),
      offsetMs: number(rhythm.offsetMs, '判定偏移', -250, 250),
      ...(rhythm.chartVersion !== undefined ? { chartVersion: rhythm.chartVersion as 1 | 2 } : {}),
      ...(rhythm.difficulty !== undefined ? { difficulty: rhythm.difficulty as 'relaxed' | 'normal' | 'hard' } : {}),
      ...(feedback ? { feedback } : {}),
    },
  }
}

export function spatialSeed(prompt: string): number {
  let hash = 2166136261
  for (const char of prompt) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  return (hash >>> 0) % 2147483646 + 1
}

/** Free, deterministic template compilation; intentionally not labelled as AI generation. */
export function createSpatialProject(brief: string, genre: SpatialProject['genre'] = 'exploration'): SpatialProject {
  const idea = brief.trim().slice(0, 4000) || '在薄荷色森林中寻找散落的能量水晶，开启远处的传送门。'
  const environment = /雪|冰|snow|ice/i.test(idea) ? 'snow'
    : /沙|荒漠|desert|dune/i.test(idea) ? 'desert'
      : /夜|星|太空|night|space|neon/i.test(idea) ? 'night' : 'forest'
  return parseSpatialProject({
    schema: 'pixel-world/spatial', version: 1,
    title: `${SPATIAL_ENVIRONMENTS[environment]} · ${genre === 'rhythm' ? '节奏回响' : '水晶之旅'}`,
    brief: idea, genre, environment, seed: spatialSeed(idea), arenaSize: 32,
    goalCount: 6, decorationCount: 30, playerSpeed: 2,
    rhythm: { bpm: 100, bars: 8, offsetMs: 0, chartVersion: 2, difficulty: 'normal', feedback: { effects: .7, hitVolume: .8, musicVolume: .55, shake: false } },
  })
}

export function serializeSpatialProject(project: SpatialProject): string {
  return JSON.stringify(parseSpatialProject(project), null, 2)
}
