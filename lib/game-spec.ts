import { ANIMATION_CLIP_POSES, ASSET_CATALOG, createAssetPlan, normalizeAnimationSpec } from '@/lib/asset-catalog'
import { stabilizeGameSpec } from '@/lib/game-spec-guardrails'
import { extractStoryAnchors } from '@/lib/story-anchors'
import { alignNarrativeCast, ensureNarrative, normalizeNarrative } from '@/lib/narrative'
import { normalizeCreationLanguage } from '@/lib/creation-language'
import { characterRosterRules } from '@/lib/character-roster'
import { behaviorProgramRules } from '@/lib/behavior-program'
import { originalArtRules } from '@/lib/original-art'
import { heroPhysics } from '@/lib/hero-physics'
import { authoredMapRules } from '@/lib/authored-map'
import { validateReference } from '@/lib/reference-analysis'
import {readTemplateAttributions} from '@/lib/template-attribution'
import type {
  AssetCategory,
  AssetDefinition,
  BossSpec,
  CollectibleSpec,
  CreationLanguage,
  EnemySpec,
  GameSpec,
  HeroSpec,
  LevelSpec,
  VisualStyleSpec,
  WeaponSpec,
} from '@/types'

const SECTION_LABELS = [
  'background', 'world', 'character', 'hero', 'enemy', 'enemies', 'weapon',
  'ground texture', 'ground', 'obstacle', 'boss', 'collectible', 'collectibles',
  'projectile', 'attack effect', 'background story', 'story',
  '背景', '世界', '主角', '人物', '敌人', '怪物', '武器', '地面', '障碍物',
  '首领', '收集品', '弹射物', '攻击特效', '背景故事',
]

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function section(source: string, aliases: string[], fallback: string): string {
  const escaped = SECTION_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  for (const alias of aliases) {
    const key = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?:^|[\\n。；;])\\s*${key}\\s*(?:is|是)?\\s*[:：]?\\s*([\\s\\S]*?)(?=(?:[\\n。；;])\\s*(?:${escaped})\\s*(?:is|是)?\\s*[:：]?|$)`, 'i')
    const match = source.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim().replace(/\n+/g, ' ')
  }
  return fallback
}

function normalizeFieldLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/：/g, ':')
}

function parseStructuredFields(source: string): Map<string, string> {
  const fields = new Map<string, string>()
  let currentKey = ''
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    const match = line.match(/^([^:：]{1,80})\s*[:：]\s*(.*)$/)
    if (match) {
      currentKey = normalizeFieldLabel(match[1])
      fields.set(currentKey, match[2].trim())
    } else if (currentKey && line) {
      fields.set(currentKey, `${fields.get(currentKey) || ''} ${line}`.trim())
    }
  }
  return fields
}

function globalPrompt(source: string): string {
  const firstLevel = source.search(/^\s*(?:LEVEL|关卡)\s*1\s*[:：]/im)
  return firstLevel >= 0 ? source.slice(0, firstLevel) : source
}

function structuredField(source: string, aliases: string[]): string {
  const fields = parseStructuredFields(globalPrompt(source))
  for (const alias of aliases) {
    const value = fields.get(normalizeFieldLabel(alias))
    if (value?.trim()) return value.trim()
  }
  return ''
}

interface ParsedLevelBlock {
  name: string
  fields: Map<string, string>
  raw: string
}

function parsedLevelBlock(source: string, index: number): ParsedLevelBlock | null {
  const current = index + 1
  const next = current + 1
  const pattern = new RegExp(
    `^\\s*(?:LEVEL|关卡)\\s*${current}\\s*[:：]\\s*([^\\n]*)\\n?([\\s\\S]*?)(?=^\\s*(?:LEVEL|关卡)\\s*${next}\\s*[:：]|(?![\\s\\S]))`,
    'im',
  )
  const match = source.match(pattern)
  if (!match) return null
  return { name: match[1].trim(), fields: parseStructuredFields(match[2]), raw: match[2].trim() }
}

function levelField(block: ParsedLevelBlock | null, aliases: string[]): string {
  if (!block) return ''
  for (const alias of aliases) {
    const value = block.fields.get(normalizeFieldLabel(alias))
    if (value?.trim()) return value.trim()
  }
  return ''
}

function levelDescription(source: string, index: number, fallback: string): string {
  const current = index + 1
  const match = source.match(new RegExp(`(?:LEVEL|关卡)\\s*${current}[^\\n]*[:：]?\\s*([\\s\\S]*?)(?=(?:LEVEL|关卡)\\s*${current + 1}|$)`, 'i'))
  return match?.[1]?.trim().replace(/\n+/g, ' ') || fallback
}

function levelDefaults(index: number, count: number, description: string): Pick<LevelSpec, 'platformMode' | 'music' | 'effects'> {
  const platformMode = /water|underwater|river|ocean|水域|水下|海洋/i.test(description)
    ? 'water'
    : /sky|air|cloud|float|天空|空中|漂浮/i.test(description) ? 'air' : 'ground'
  return {
    platformMode,
    music: {
      tempo: Math.min(148, 92 + index * 8),
      rootFrequency: 130.81 * (1 + index * 0.04),
      waveform: index === count - 1 ? 'sawtooth' : 'triangle',
      scale: [0, 3, 5, 7, 10, 7, 5, 3],
      intensity: Math.min(1, 0.48 + index * 0.1),
    },
    effects: {
      weather: index === count - 1 ? 'embers' : index === 2 ? 'mist' : 'none',
      filter: platformMode === 'water' ? 'underwater' : index === count - 1 ? 'danger' : 'none',
      flash: index === count - 1,
      intensity: Math.min(1, 0.35 + index * 0.1),
    },
  }
}

const CATEGORY_MENTION_TERMS: Partial<Record<AssetCategory, string[]>> = {
  hero: ['主角'],
  groundEnemy: ['地面敌人'], groundEnemyAttackEffect: ['地面敌人'], groundEnemyMotion: ['地面敌人'], groundEnemyAttackSound: ['地面敌人'], groundEnemyMoveSound: ['地面敌人'],
  airEnemy: ['空中敌人'], airEnemyAttackEffect: ['空中敌人'], airEnemyMotion: ['空中敌人'], airEnemyAttackSound: ['空中敌人'], airEnemyMoveSound: ['空中敌人'],
  waterEnemy: ['水中敌人'], waterEnemyAttackEffect: ['水中敌人'], waterEnemyMotion: ['水中敌人'], waterEnemyAttackSound: ['水中敌人'], waterEnemyMoveSound: ['水中敌人'],
  boss: ['boss', '首领'], bossAttackEffect: ['boss', '首领'], bossMotion: ['boss', '首领'], bossAttackSound: ['boss', '首领'], bossMoveSound: ['boss', '首领'],
  meleeWeapon: ['近战武器'], meleeAttackEffect: ['近战攻击特效', '全部玩家攻击特效', '全部攻击特效'], meleeAttackSound: ['近战攻击音效', '全部玩家攻击特效', '全部攻击特效'],
  rangedWeapon: ['远程武器'], rangedProjectile: ['远程弹射物'], rangedAttackEffect: ['远程攻击', '全部玩家攻击特效', '全部攻击特效'], rangedAttackSound: ['远程攻击', '全部玩家攻击特效', '全部攻击特效'],
  collectible: ['收集品'], groundPlatform: ['地面平台'], waterPlatform: ['水域'], airPlatform: ['大气', '漂浮平台'],
  deathObstacle: ['触碰即死', '尖刺'], bounceObstacle: ['弹跳'], normalObstacle: ['普通障碍物'],
}

function assignedLevelIds(asset: AssetDefinition, levels: LevelSpec[], mentions: string[]): string[] {
  if (asset.category === 'levelBackground' || asset.category === 'levelMusic' || asset.category === 'levelEffect') return asset.levelIds
  if (asset.category === 'boss' || asset.category.startsWith('boss')) return levels.slice(-1).map((level) => level.id)
  if (asset.category === 'waterPlatform') return levels.filter((level) => level.platformMode === 'water').map((level) => level.id)
  if (asset.category === 'airPlatform') return levels.filter((level) => level.platformMode === 'air').map((level) => level.id)
  const terms = CATEGORY_MENTION_TERMS[asset.category] || []
  const matched = levels.filter((_, index) => terms.some((term) => mentions[index]?.toLowerCase().includes(term.toLowerCase())))
  return matched.length ? matched.map((level) => level.id) : asset.levelIds
}

function customizeAssetPrompts(
  assets: AssetDefinition[],
  levels: LevelSpec[],
  values: Partial<Record<AssetCategory, string>>,
  explicitValues: Partial<Record<AssetCategory, string>>,
  mentions: string[],
): AssetDefinition[] {
  return assets.map((asset) => {
    if (asset.category === 'levelBackground' || asset.category === 'levelMusic' || asset.category === 'levelEffect') {
      const level = levels.find((candidate) => asset.levelIds.includes(candidate.id)) || levels[0]
      const prompt = asset.category === 'levelBackground'
        ? level.environment
        : asset.category === 'levelMusic'
          ? `A looping pixel-game score for ${level.name}: ${level.environment}`
          : `Weather and screen effects for ${level.name}: ${level.environment}`
      return { ...asset, prompt }
    }
    const levelIds = assignedLevelIds(asset, levels, mentions)
    return {
      ...asset,
      prompt: values[asset.category] || asset.prompt,
      enabled: explicitValues[asset.category]?.trim() ? true : asset.enabled,
      levelIds: levelIds.length ? levelIds : asset.levelIds,
    }
  })
}

export function createFallbackGameSpec(sourcePrompt: string, themeName = 'Pixel World', requestedLevelCount = 3, creationLanguage: CreationLanguage = 'zh-CN'): GameSpec {
  const prompt = sourcePrompt.trim()
  const creativeFields = parseStructuredFields(prompt)
  const creativeBrief = {
    heroGoal: creativeFields.get(normalizeFieldLabel('主角目标（可选）')) || structuredField(prompt, ['主角目标']),
    difficulty: creativeFields.get(normalizeFieldLabel('难度偏好（可选）')) || structuredField(prompt, ['难度偏好']),
    pacing: creativeFields.get(normalizeFieldLabel('叙事节奏（可选）')) || structuredField(prompt, ['叙事节奏']),
    identityRules: creativeFields.get(normalizeFieldLabel('角色一致性要求（可选）')) || structuredField(prompt, ['角色一致性要求']),
  }
  const hasStructuredFieldSyntax = prompt.split(/\r?\n/).some((line) =>
    /^(?:游戏标题|世界观与故事|背景故事|整体像素风格|主角\s*\/|地面敌人\s*\/|空中敌人\s*\/|水中敌人\s*\/|BOSS|关卡\s*\d+)\s*[:：]/i.test(line.trim()),
  )
  // Structured forms contain many labels. Fuzzy free-text section matching
  // must not read the tail of one label (for example “观与故事”) as content.
  const freeformPrompt = hasStructuredFieldSyntax ? '' : prompt
  const levelCount = Math.min(10, Math.max(1, requestedLevelCount || 1))
  const explicitAssetValues = Object.fromEntries(ASSET_CATALOG.map((entry) => [
    entry.category,
    structuredField(prompt, [entry.label, entry.category, entry.label.split(' / ')[0]]),
  ])) as Partial<Record<AssetCategory, string>>
  const assetValues = Object.fromEntries(ASSET_CATALOG.map((entry) => [
    entry.category,
    explicitAssetValues[entry.category] || entry.defaultPrompt,
  ])) as Partial<Record<AssetCategory, string>>

  const explicitWorld = structuredField(prompt, ['世界观与故事', '世界观', 'world'])
  const world = explicitWorld
    || section(freeformPrompt, ['world', '世界'], freeformPrompt || 'A mysterious original fantasy pixel world with readable platforming spaces.')
  const storyAnchors = extractStoryAnchors(world)
  const sceneEnemy = storyAnchors.place
    ? `One original ground enemy native to ${storyAnchors.place}${storyAnchors.enemy ? `: ${storyAnchors.enemy}${/机器人/.test(storyAnchors.enemy) ? ', a small patrol robot with mechanical limbs and a sensor eye' : /无人机/.test(storyAnchors.enemy) ? ', a compact patrol drone with visible rotors and a sensor eye' : ''}, with a distinct recognizable silhouette` : /巡逻机器人/.test(world) ? ': a small patrol robot with mechanical limbs, a sensor eye, and a clear machine silhouette' : /日本/.test(storyAnchors.place) ? ': a small animated lantern spirit inspired by Japanese folklore, with a warm paper glow and a distinct face' : /沙漠|埃及/.test(storyAnchors.place) ? ': a sand-colored desert beetle with a rounded shell and six clear legs' : /月球/.test(storyAnchors.place) ? ': a compact moon-dust creature with rocky limbs and a luminous core' : ''}; a consistent side-view pixel creature with one recognizable silhouette across every animation frame, isolated from the background.`
    : assetValues.groundEnemy || 'A hostile original creature with a readable side-view combat silhouette.'
  const heroAppearance = explicitAssetValues.hero
    || (storyAnchors.hero
      ? `An original full-body side-view pixel hero based on ${storyAnchors.hero}, with a clear silhouette and equipment suited to the adventure.`
      : section(freeformPrompt, ['character', 'hero', '主角', '人物'], assetValues.hero || 'A brave side-view adult adventurer with a strong silhouette and practical travel armor.'))
  const enemyAppearance = explicitAssetValues.groundEnemy
    || section(freeformPrompt, ['enemy', 'enemies', '敌人', '怪物'], sceneEnemy)
  const meleeWeapon = explicitAssetValues.meleeWeapon || assetValues.meleeWeapon || 'One compact original melee weapon.'
  const rangedWeapon = explicitAssetValues.rangedWeapon || assetValues.rangedWeapon || 'One compact original ranged weapon.'
  const weaponAppearance = `${meleeWeapon} Ranged companion: ${rangedWeapon}`
  const ground = explicitAssetValues.groundPlatform
    || section(freeformPrompt, ['ground texture', 'ground', '地面'], assetValues.groundPlatform || 'A seamless side-view stone-and-soil platform texture.')
  const obstacle = explicitAssetValues.normalObstacle
    || section(freeformPrompt, ['obstacle', '障碍物'], assetValues.normalObstacle || 'A solid themed blocking object with a simple collision-friendly silhouette.')
  const bossAppearance = explicitAssetValues.boss
    || (storyAnchors.antagonist
      ? `An original full-body side-view pixel boss based on ${storyAnchors.antagonist}, with a distinct readable combat silhouette.`
      : section(freeformPrompt, ['boss', '首领'], assetValues.boss || `A towering original guardian evolved from the world's hostile creatures: ${enemyAppearance}`))
  const collectibleAppearance = explicitAssetValues.collectible
    || (storyAnchors.collectible
      ? `One isolated side-view pixel pickup based on ${storyAnchors.collectible}, with a compact readable silhouette.`
      : section(freeformPrompt, ['collectible', 'collectibles', '收集品'], assetValues.collectible || 'A luminous crystal pickup with a compact readable silhouette.'))
  const projectile = explicitAssetValues.rangedProjectile
    || section(freeformPrompt, ['projectile', '弹射物'], assetValues.rangedProjectile || 'A small bright horizontal energy bolt matching the ranged weapon palette.')
  const attackEffect = explicitAssetValues.meleeAttackEffect
    || section(freeformPrompt, ['attack effect', '攻击特效'], assetValues.meleeAttackEffect || 'A compact crescent slash effect with transparent surroundings.')
  const backgroundStory = structuredField(prompt, ['背景故事', 'background story', 'story'])
    || (explicitWorld ? explicitWorld : section(freeformPrompt, ['background story', 'story', '背景故事'], `Long ago, ${themeName || 'this pixel world'} was protected by the power sealed inside the ${collectibleAppearance}. When ${bossAppearance} shattered that balance, a lone adventurer carrying original weapons set out to reconnect the lost regions, recover the scattered energy, and defeat the final guardian.`))
  const levelMentions: string[] = []

  const levels: LevelSpec[] = Array.from({ length: levelCount }, (_, index) => {
    const block = parsedLevelBlock(prompt, index)
    const place = storyAnchors.place
    const defaultEnvironment = place
      ? `${index === levelCount - 1 ? 'Final confrontation at' : index === 0 ? 'Approach to' : 'A distinct route through'} ${place}; an original side-view pixel environment with clear traversal lanes.`
      : `${world} — region ${index + 1}, with progressively stronger atmosphere and clear traversal lanes.`
    const environment = levelField(block, ['背景', 'background'])
      || (block ? defaultEnvironment : levelDescription(freeformPrompt, index, defaultEnvironment))
    const platformText = levelField(block, ['平台类型', 'platform type'])
    const levelObstacle = levelField(block, ['障碍物', 'obstacles']) || obstacle
    const musicText = levelField(block, ['背景音乐', 'music'])
    const effectsText = levelField(block, ['天气/滤镜/闪光', '关卡特效', 'effects'])
    const enemyCountText = levelField(block, ['敌人数', 'enemy count'])
    const collectibleCountText = levelField(block, ['收集品数', 'collectible count'])
    const bossText = levelField(block, ['boss', '首领'])
    levelMentions[index] = levelField(block, ['出现素材', 'assets'])
    const defaults = levelDefaults(index, levelCount, `${environment} ${platformText}`)
    const platformMode: LevelSpec['platformMode'] = /water|underwater|river|ocean|水域|水下|海洋/i.test(platformText)
      ? 'water'
      : /sky|air|cloud|float|大气|空中|漂浮/i.test(platformText) ? 'air' : defaults.platformMode
    const bpm = Number(musicText.match(/(\d{2,3})\s*BPM/i)?.[1])
    const weather: LevelSpec['effects']['weather'] = /ember|余烬/i.test(effectsText) ? 'embers'
      : /snow|雪/i.test(effectsText) ? 'snow'
        : /rain|雨/i.test(effectsText) ? 'rain'
          : /star|星尘|星光/i.test(effectsText) ? 'stars'
            : /mist|fog|雾/i.test(effectsText) ? 'mist' : defaults.effects.weather
    const filter: LevelSpec['effects']['filter'] = /underwater|水下/i.test(effectsText) ? 'underwater'
      : /danger|危险/i.test(effectsText) ? 'danger'
        : /dream|梦境/i.test(effectsText) ? 'dream'
          : /warm|暖色/i.test(effectsText) ? 'warm'
            : /cold|冷色/i.test(effectsText) ? 'cold' : defaults.effects.filter
    return {
      id: `level-${index + 1}`,
      name: block?.name || `Level ${index + 1}`,
      environment,
      ground,
      obstacle: levelObstacle,
      enemyCount: Math.min(6, Math.max(0, Number(enemyCountText.match(/\d+/)?.[0] ?? 3 + index))),
      collectibleCount: Math.min(8, Math.max(0, Number(collectibleCountText.match(/\d+/)?.[0] ?? 3 + index))),
      hasBoss: index === levelCount - 1 || /yes|true|是|有/i.test(bossText),
      ...defaults,
      platformMode,
      music: {
        ...defaults.music,
        tempo: Number.isFinite(bpm) ? Math.min(220, Math.max(50, bpm)) : defaults.music.tempo,
      },
      effects: {
        ...defaults.effects,
        weather,
        filter,
        flash: /闪光|flash/i.test(effectsText) || defaults.effects.flash,
      },
    }
  })

  const assets = customizeAssetPrompts(
    createAssetPlan(levels.map((level) => level.id)),
    levels,
    { ...assetValues, hero: heroAppearance, groundEnemy: enemyAppearance, boss: bossAppearance, meleeWeapon, rangedWeapon, rangedProjectile: projectile, meleeAttackEffect: attackEffect, collectible: collectibleAppearance, groundPlatform: ground, normalObstacle: obstacle },
    explicitAssetValues,
    levelMentions,
  )

  const visualStyle = structuredField(prompt, ['整体像素风格', '视觉风格', 'visual style'])

  return ensureNarrative(stabilizeGameSpec({
    version: 3,
    creationLanguage: normalizeCreationLanguage(creationLanguage),
    title: structuredField(prompt, ['游戏标题', 'game title']) || themeName.trim() || 'Pixel World',
    world,
    backgroundStory,
    visualStyle: {
      artDirection: visualStyle || 'Original cohesive 16-bit side-scrolling pixel art, crisp hard pixel edges, no antialiasing.',
      palette: 'One unified bright high-saturation palette with luminous midtones, colorful shadows, vivid biome colors and no gray or muddy wash.',
      lighting: 'Clear luminous light from the upper left with crisp silhouettes, sparkling highlights and readable depth in every scene.',
      pixelScale: 'Consistent 2x pixel scale and side-view orthographic camera.',
    },
    creativeBrief,
    hero: { name: storyAnchors.hero || 'Hero', appearance: heroAppearance, maxHealth: 100, moveSpeed: 5, jumpPower: 15 },
    weapon: { name: 'Seedblade', appearance: weaponAppearance, mode: 'hybrid', meleeDamage: 24, rangedDamage: 16, cooldownMs: 420, projectileSpeed: 10 },
    enemies: [{ name: 'World Stalker', appearance: enemyAppearance, health: 48, damage: 12, speed: 1.4, behavior: 'chase' }],
    boss: { name: storyAnchors.antagonist || 'World Guardian', appearance: bossAppearance, health: 280, damage: 20, speed: 1.1, attackPattern: creationLanguage === 'en' ? 'Approaches the player, fires projectiles at intervals, and jumps periodically.' : '移动接近主角，间隔发射弹射物，并定时跳跃。' },
    collectible: { name: storyAnchors.collectible || 'Inner Seed', appearance: collectibleAppearance, effect: 'score', value: 100 },
    projectile,
    attackEffect,
    levels,
    assets,
  }), prompt, explicitWorld || structuredField(prompt, ['背景故事', 'background story', 'story']) || freeformPrompt)
}

/** Keep every user-filled structured field attached to its exact category. */
export function preserveExplicitPromptFields(spec: GameSpec, fallback: GameSpec, sourcePrompt: string): GameSpec {
  const explicitCategories = new Map<AssetCategory, string>()
  for (const entry of ASSET_CATALOG) {
    const value = structuredField(sourcePrompt, [entry.label, entry.category, entry.label.split(' / ')[0]])
    if (value) explicitCategories.set(entry.category, value)
  }
  const exact = (aliases: string[]) => structuredField(sourcePrompt, aliases)
  const levels = spec.levels.map((level, index) => {
    const block = parsedLevelBlock(sourcePrompt, index)
    const fallbackLevel = fallback.levels[index] || level
    return {
      ...level,
      name: block?.name || level.name,
      environment: levelField(block, ['背景', 'background']) ? fallbackLevel.environment : level.environment,
      obstacle: levelField(block, ['障碍物', 'obstacles']) ? fallbackLevel.obstacle : level.obstacle,
      platformMode: levelField(block, ['平台类型', 'platform type']) ? fallbackLevel.platformMode : level.platformMode,
      music: levelField(block, ['背景音乐', 'music']) ? fallbackLevel.music : level.music,
      effects: levelField(block, ['天气/滤镜/闪光', '关卡特效', 'effects']) ? fallbackLevel.effects : level.effects,
    }
  })
  return {
    ...spec,
    title: exact(['游戏标题', 'game title']) ? fallback.title : spec.title,
    world: fallback.narrative?.source.lockedFields.world || spec.world,
    backgroundStory: fallback.narrative?.source.lockedFields.backgroundStory || spec.backgroundStory,
    narrative: fallback.narrative ? normalizeNarrative({ ...spec.narrative, source: fallback.narrative.source }, spec, fallback.narrative) : spec.narrative,
    visualStyle: fallback.narrative?.source.playerFields['visualStyle.artDirection']
      ? { ...spec.visualStyle, artDirection: fallback.narrative.source.playerFields['visualStyle.artDirection'] }
      : exact(['整体像素风格', '视觉风格', 'visual style']) ? fallback.visualStyle : spec.visualStyle,
    hero: explicitCategories.has('hero') ? { ...spec.hero, appearance: fallback.hero.appearance } : spec.hero,
    enemies: explicitCategories.has('groundEnemy') ? spec.enemies.map((enemy, index) => index === 0 ? { ...enemy, appearance: fallback.enemies[0].appearance } : enemy) : spec.enemies,
    weapon: explicitCategories.has('meleeWeapon') || explicitCategories.has('rangedWeapon')
      ? { ...spec.weapon, appearance: fallback.weapon.appearance }
      : spec.weapon,
    boss: explicitCategories.has('boss') ? { ...spec.boss, appearance: fallback.boss.appearance } : spec.boss,
    collectible: explicitCategories.has('collectible') ? { ...spec.collectible, appearance: fallback.collectible.appearance } : spec.collectible,
    projectile: explicitCategories.has('rangedProjectile') ? fallback.projectile : spec.projectile,
    attackEffect: explicitCategories.has('meleeAttackEffect') ? fallback.attackEffect : spec.attackEffect,
    levels,
    assets: spec.assets.map((asset) => {
      const explicitPrompt = explicitCategories.get(asset.category)
      const fallbackAsset = fallback.assets.find((candidate) => candidate.id === asset.id)
        || fallback.assets.find((candidate) => candidate.category === asset.category && candidate.levelIds.some((id) => asset.levelIds.includes(id)))
      return explicitPrompt
        ? { ...asset, prompt: explicitPrompt, enabled: true, levelIds: fallbackAsset?.levelIds || asset.levelIds }
        : asset
    }),
  }
}

/** Preserve the same authored contract in storage migration and Agent review. */
export function authoredGameSpecBaseline(value:GameSpec|undefined,fallback:GameSpec):GameSpec|undefined {
  if(value?.version!==3||!(Array.isArray(value.levels)&&value.levels.some(l=>l.map)||value.hero?.physics||value.hero?.roster||value.boss?.program||Array.isArray(value.enemies)&&value.enemies.some(e=>e.program)))return undefined
  return {...fallback,...value,hero:{...fallback.hero,...value.hero},weapon:{...fallback.weapon,...value.weapon},boss:{...fallback.boss,...value.boss},enemies:Array.isArray(value.enemies)?value.enemies:fallback.enemies,levels:Array.isArray(value.levels)?value.levels:fallback.levels,assets:Array.isArray(value.assets)?value.assets:fallback.assets}
}

export function normalizeGameSpec(candidate: unknown, fallback: GameSpec, requestedLevelCount = fallback.levels.length): GameSpec {
  const input = candidate && typeof candidate === 'object' ? candidate as Partial<GameSpec> : {}
  const visual = input.visualStyle as Partial<VisualStyleSpec> | undefined
  const hero = input.hero as Partial<HeroSpec> | undefined
  const weapon = input.weapon as Partial<WeaponSpec> | undefined
  const boss = input.boss as Partial<BossSpec> | undefined
  const collectible = input.collectible as Partial<CollectibleSpec> | undefined
  const count = Math.min(10, Math.max(1, requestedLevelCount || fallback.levels.length))
  const proposedEnemies = Array.isArray(input.enemies) ? input.enemies : fallback.enemies
  const rawEnemies = fallback.enemies.some(e => e.program) ? fallback.enemies.map((base,i) => ({...base,...proposedEnemies[i],program:base.program})) : proposedEnemies
  const rawLevels = Array.isArray(input.levels) ? input.levels : fallback.levels

  const enemies: EnemySpec[] = rawEnemies.slice(0, 8).map((raw, index) => {
    const enemy = raw as Partial<EnemySpec>
    const base = fallback.enemies[Math.min(index, fallback.enemies.length - 1)]
    return {
      name: text(enemy.name, base.name),
      appearance: text(enemy.appearance, base.appearance),
      program: base.program || enemy.program ? behaviorProgramRules.validate(base.program || enemy.program) : undefined,
      health: bounded(enemy.health, base.health, 10, 300),
      damage: bounded(enemy.damage, base.damage, 1, 80),
      speed: bounded(enemy.speed, base.speed, 0.4, 5),
      behavior: ['patrol', 'chase', 'ranged'].includes(String(enemy.behavior)) ? enemy.behavior as EnemySpec['behavior'] : base.behavior,
      category: ['groundEnemy', 'airEnemy', 'waterEnemy'].includes(String(enemy.category))
        ? enemy.category as EnemySpec['category']
        : (['groundEnemy', 'airEnemy', 'waterEnemy'] as const)[index],
      assetId: typeof enemy.assetId === 'string' && enemy.assetId.trim() ? enemy.assetId.trim() : undefined,
    }
  })

  const levels: LevelSpec[] = Array.from({ length: count }, (_, index) => {
    const base = fallback.levels[index] || { ...fallback.levels[fallback.levels.length - 1], map: undefined, id: `level-${index + 1}`, name: `第 ${index + 1} 关` }
    const byId = rawLevels.find(level => level?.id === base.id)
    const positional = !rawLevels.some(level => level?.id) || rawLevels.length === count
    const raw = (byId || (positional ? rawLevels[index] : undefined) || base) as Partial<LevelSpec>
    const environment = text(raw.environment, base.environment)
    const defaults = levelDefaults(index, count, environment)
    const map = base.map || raw.map ? authoredMapRules.validate(base.map || raw.map) : undefined
    return {
      id: base.id,
      map,
      name: text(raw.name, base.name),
      environment,
      ground: text(raw.ground, base.ground),
      obstacle: text(raw.obstacle, base.obstacle),
      enemyCount: map ? map.enemies.length : bounded(raw.enemyCount, base.enemyCount, 0, 12),
      collectibleCount: map ? map.collectibles.length : bounded(raw.collectibleCount, base.collectibleCount, 0, 10),
      hasBoss: map ? !!map.boss : index === count - 1 || Boolean(raw.hasBoss),
      platformMode: ['ground', 'water', 'air'].includes(String(raw.platformMode)) ? raw.platformMode as LevelSpec['platformMode'] : defaults.platformMode,
      music: {
        tempo: bounded(raw.music?.tempo, defaults.music.tempo, 50, 220),
        rootFrequency: bounded(raw.music?.rootFrequency, defaults.music.rootFrequency, 55, 880),
        waveform: ['sine', 'square', 'sawtooth', 'triangle'].includes(String(raw.music?.waveform)) ? raw.music?.waveform as OscillatorType : defaults.music.waveform,
        scale: Array.isArray(raw.music?.scale) ? raw.music.scale.slice(0, 16).map((value) => bounded(value, 0, -24, 24)) : defaults.music.scale,
        intensity: bounded(raw.music?.intensity, defaults.music.intensity, 0, 1),
      },
      effects: {
        weather: ['none', 'rain', 'snow', 'embers', 'mist', 'stars'].includes(String(raw.effects?.weather)) ? raw.effects?.weather as LevelSpec['effects']['weather'] : defaults.effects.weather,
        filter: ['none', 'cold', 'warm', 'dream', 'danger', 'underwater'].includes(String(raw.effects?.filter)) ? raw.effects?.filter as LevelSpec['effects']['filter'] : defaults.effects.filter,
        flash: typeof raw.effects?.flash === 'boolean' ? raw.effects.flash : defaults.effects.flash,
        intensity: bounded(raw.effects?.intensity, defaults.effects.intensity, 0, 1),
      },
    }
  })

  const defaultAssets = createAssetPlan(levels.map((level) => level.id))
  const providedAssets = Array.isArray(input.assets) ? input.assets : []
  const requiredAssets = fallback.assets?.length ? fallback.assets : defaultAssets
  const consumed = new Set<number>()
  const rawAssets: Partial<AssetDefinition>[] = requiredAssets.map((required) => {
    const matchIndex = providedAssets.findIndex((candidate, index) => {
      if (consumed.has(index) || !candidate) return false
      if (candidate.id === required.id) return true
      return candidate.category === required.category
        && (!candidate.levelIds?.length || candidate.levelIds.some((id) => required.levelIds.includes(id)))
    })
    if (matchIndex < 0) return required
    consumed.add(matchIndex)
    const proposed = { ...required, ...providedAssets[matchIndex] }
    if(required.original){proposed.original=required.original;proposed.url=required.url;proposed.kind=required.kind;proposed.source=undefined}
    const originals=Object.entries(required.animation?.clips||{}).filter(([,clip])=>clip?.original)
    if(originals.length){proposed.kind='spriteSheet';proposed.animation={...(proposed.animation||required.animation!),clips:{...proposed.animation?.clips,...Object.fromEntries(originals)}}}
    return proposed
  })
  providedAssets.forEach((asset, index) => {
    if (!consumed.has(index) && asset && ASSET_CATALOG.some((entry) => entry.category === asset.category)) rawAssets.push(asset)
  })
  const knownLevels = new Set(levels.map((level) => level.id))
  const assets: AssetDefinition[] = rawAssets.map((rawAsset, index) => {
    const asset = rawAsset as Partial<AssetDefinition>
    const explicitlyProvided = providedAssets.some((item) => item.id === asset.id && Boolean(item.prompt?.trim()))
    let derivedPrompt = asset.prompt
    if (!explicitlyProvided && !asset.url) {
      if (asset.category === 'hero' && hero?.appearance) derivedPrompt = hero.appearance
      else if (asset.category === 'boss' && boss?.appearance) derivedPrompt = boss.appearance
      else if (asset.category === 'collectible' && collectible?.appearance) derivedPrompt = collectible.appearance
      else if (['groundEnemy', 'airEnemy', 'waterEnemy'].includes(String(asset.category))) {
        const enemy = enemies.find(item => item.assetId === asset.id)
          || enemies.find(item => item.category === asset.category)
        if (enemy?.appearance) derivedPrompt = enemy.appearance
      }
      else if (asset.category === 'rangedProjectile' && input.projectile) derivedPrompt = input.projectile
      else if (asset.category === 'meleeAttackEffect' && input.attackEffect) derivedPrompt = input.attackEffect
      else if (asset.category === 'levelBackground') {
        const level = levels.find((item) => asset.levelIds?.includes(item.id))
        const prior = fallback.levels.find((item) => item.id === level?.id)
        if (level && level.environment !== prior?.environment) derivedPrompt = level.environment
      }
    }
    const base = defaultAssets.find((item) => item.category === asset.category) || defaultAssets[index % defaultAssets.length]
    const validLevelIds = Array.isArray(asset.levelIds) ? asset.levelIds.filter((id): id is string => typeof id === 'string' && knownLevels.has(id)) : base.levelIds
    const url = text(asset.url, '')
    const kind = ['image', 'spriteSheet', 'audio', 'runtime'].includes(String(asset.kind)) ? asset.kind as AssetDefinition['kind'] : base.kind
    const animation = kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation || base.animation) : undefined
    const animationComplete = animation?.layoutVersion === 3 && animation.clips
      ? ANIMATION_CLIP_POSES.filter((pose) => animation.clips?.[pose]?.enabled !== false).every((pose) => Boolean(animation.clips?.[pose]?.url && animation.clips[pose]?.status === 'success'))
      : Boolean(url)
    const requestedStatus = String(asset.status)
    const status: AssetDefinition['status'] = animationComplete
      ? 'success'
      : base.kind === 'audio' || base.kind === 'runtime'
        ? 'success'
        : requestedStatus === 'failed' || requestedStatus === 'cancelled'
          ? requestedStatus
          : 'pending'
    return {
      ...base,
      id: text(asset.id, `${base.category}-${index + 1}`),
      title: text(asset.title, base.title),
      prompt: text(derivedPrompt, base.prompt),
      enabled: typeof asset.enabled === 'boolean' ? asset.enabled : base.enabled,
      levelIds: validLevelIds,
      kind,
      original:asset.original?originalArtRules.validate(asset.original):undefined,
      status,
      url: url || undefined,
      source: asset.source === 'builtin-fallback' ? 'builtin-fallback' : undefined,
      error: text(asset.error, '') || undefined,
      animation,
      sound: asset.sound || base.sound,
      motion: asset.motion || base.motion,
    }
  })

  const normalized = alignNarrativeCast({
    version: 3,
    reference: fallback.reference || input.reference ? validateReference(fallback.reference || input.reference) : undefined,
    templateSources:readTemplateAttributions(fallback.templateSources) || readTemplateAttributions(input.templateSources),
    creationLanguage: normalizeCreationLanguage(fallback.creationLanguage),
    narrative: normalizeNarrative({ ...input.narrative, opening: input.narrative?.opening || input.backgroundStory || fallback.narrative?.opening, source: fallback.narrative?.source || input.narrative?.source }, { ...fallback, levels }, fallback.narrative),
    title: text(input.title, fallback.title),
    creativeBrief: {
      heroGoal: text(fallback.creativeBrief?.heroGoal, text(input.creativeBrief?.heroGoal, '')),
      difficulty: text(fallback.creativeBrief?.difficulty, text(input.creativeBrief?.difficulty, '')),
      pacing: text(fallback.creativeBrief?.pacing, text(input.creativeBrief?.pacing, '')),
      identityRules: text(fallback.creativeBrief?.identityRules, text(input.creativeBrief?.identityRules, '')),
    },
    world: text(input.world, fallback.world),
    backgroundStory: text(input.backgroundStory, fallback.backgroundStory),
    visualStyle: {
      artDirection: text(visual?.artDirection, fallback.visualStyle.artDirection),
      palette: text(visual?.palette, fallback.visualStyle.palette),
      lighting: text(visual?.lighting, fallback.visualStyle.lighting),
      pixelScale: text(visual?.pixelScale, fallback.visualStyle.pixelScale),
    },
    hero: {
      name: text(hero?.name, fallback.hero.name), appearance: text(hero?.appearance, fallback.hero.appearance),
      maxHealth: bounded(hero?.maxHealth, fallback.hero.maxHealth, 40, 300), moveSpeed: bounded(hero?.moveSpeed, fallback.hero.moveSpeed, 2, 9), jumpPower: bounded(hero?.jumpPower, fallback.hero.jumpPower, 8, 24),
      roster: fallback.hero.roster || hero?.roster ? characterRosterRules.validate(fallback.hero.roster || hero?.roster) : undefined,
      physics: fallback.hero.physics || hero?.physics ? heroPhysics.validate(fallback.hero.physics || hero!.physics!) : undefined,
    },
    weapon: {
      name: text(weapon?.name, fallback.weapon.name), appearance: text(weapon?.appearance, fallback.weapon.appearance),
      mode: ['melee', 'ranged', 'hybrid'].includes(String(weapon?.mode)) ? weapon?.mode as WeaponSpec['mode'] : fallback.weapon.mode,
      meleeDamage: bounded(weapon?.meleeDamage, fallback.weapon.meleeDamage, 5, 100), rangedDamage: bounded(weapon?.rangedDamage, fallback.weapon.rangedDamage, 5, 100),
      cooldownMs: bounded(weapon?.cooldownMs, fallback.weapon.cooldownMs, 120, 2000), projectileSpeed: bounded(weapon?.projectileSpeed, fallback.weapon.projectileSpeed, 4, 24),
    },
    enemies,
    boss: {
      name: text(boss?.name, fallback.boss.name), appearance: text(boss?.appearance, fallback.boss.appearance),
      health: bounded(boss?.health, fallback.boss.health, 100, 1200), damage: bounded(boss?.damage, fallback.boss.damage, 5, 120), speed: bounded(boss?.speed, fallback.boss.speed, 0.3, 5),
      attackPattern: text(boss?.attackPattern, fallback.boss.attackPattern),
      program: fallback.boss.program || boss?.program ? behaviorProgramRules.validate(fallback.boss.program || boss?.program) : undefined,
    },
    collectible: {
      name: text(collectible?.name, fallback.collectible.name), appearance: text(collectible?.appearance, fallback.collectible.appearance),
      effect: ['score', 'heal', 'power'].includes(String(collectible?.effect)) ? collectible?.effect as CollectibleSpec['effect'] : fallback.collectible.effect,
      value: bounded(collectible?.value, fallback.collectible.value, 1, 1000),
    },
    projectile: text(input.projectile, fallback.projectile),
    attackEffect: text(input.attackEffect, fallback.attackEffect),
    levels,
    assets,
  }, fallback)
  // Explicit geometry and actor rules are a player-owned contract. Generated
  // template balance ranges must not silently rewrite an imported project.
  if(fallback.levels.some(level=>level.map)||fallback.hero.physics||fallback.hero.roster||fallback.boss.program||fallback.enemies.some(e=>e.program)){
    const keep=(value:number,min:number,max:number)=>{if(!Number.isFinite(value)||value<min||value>max)throw Error('Authored actor value exceeds runtime limits');return value}
    normalized.hero={...normalized.hero,maxHealth:keep(fallback.hero.maxHealth,1,1000),moveSpeed:keep(fallback.hero.moveSpeed,0.1,20),jumpPower:keep(fallback.hero.jumpPower,1,60)}
    normalized.weapon={...normalized.weapon,meleeDamage:keep(fallback.weapon.meleeDamage,1,1000),rangedDamage:keep(fallback.weapon.rangedDamage,1,1000),projectileSpeed:keep(fallback.weapon.projectileSpeed,1,60)}
    normalized.boss={...normalized.boss,health:keep(fallback.boss.health,1,1_000_000),damage:keep(fallback.boss.damage,0,1000),speed:keep(fallback.boss.speed,0,30)}
    normalized.enemies=normalized.enemies.map((enemy,i)=>fallback.enemies[i]?{...enemy,health:keep(fallback.enemies[i].health,1,1_000_000),damage:keep(fallback.enemies[i].damage,0,1000),speed:keep(fallback.enemies[i].speed,0,30)}:enemy)
  }
  return normalized
}

export function serializeGameSpec(spec: GameSpec): string {
  const assets = spec.assets.map((asset) => `${asset.title}：${asset.prompt}`).join('\n')
  const levels = spec.levels.map((level, index) => `关卡 ${index + 1}：${level.name}\n背景：${level.environment}\n平台类型：${level.platformMode}\n障碍物：${level.obstacle}\n敌人数：${level.enemyCount}\n收集品数：${level.collectibleCount}\n背景音乐：${level.music.tempo} BPM\n天气/滤镜/闪光：${level.effects.weather} / ${level.effects.filter} / ${level.effects.flash ? 'yes' : 'no'}\nBOSS：${level.hasBoss ? 'yes' : 'no'}`).join('\n\n')
  const brief = spec.creativeBrief
  const optional = brief ? `\n主角目标（可选）：${brief.heroGoal || ''}\n难度偏好（可选）：${brief.difficulty || ''}\n叙事节奏（可选）：${brief.pacing || ''}\n角色一致性要求（可选）：${brief.identityRules || ''}` : ''
  const narrativeFields = spec.narrative ? `\n事件起因：${spec.narrative.incitingIncident}\n主角动机：${spec.narrative.motivation}\n主要冲突：${spec.narrative.conflict}\nBoss与故事的关系：${spec.narrative.bossRelation}\n结局方向：${spec.narrative.resolution}\n开场剧情：${spec.narrative.opening}\n结局剧情：${spec.narrative.ending}` : ''
  return `游戏标题：${spec.title}\n世界观与故事：${spec.world}\n背景故事：${spec.backgroundStory}\n整体像素风格：${spec.visualStyle.artDirection} ${spec.visualStyle.palette} ${spec.visualStyle.lighting} ${spec.visualStyle.pixelScale}${optional}${narrativeFields}\n主角：${spec.hero.name} — ${spec.hero.appearance}\n近战/远程武器：${spec.weapon.name} — ${spec.weapon.appearance}\n\n${assets}\n\n${levels}`
}
