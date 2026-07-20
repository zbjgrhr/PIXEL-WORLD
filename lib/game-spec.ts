import { ANIMATION_CLIP_POSES, ASSET_CATALOG, createAssetPlan, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type {
  AssetCategory,
  AssetDefinition,
  BossSpec,
  CollectibleSpec,
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

export function createFallbackGameSpec(sourcePrompt: string, themeName = 'Pixel World', requestedLevelCount = 3): GameSpec {
  const prompt = sourcePrompt.trim()
  const levelCount = Math.min(10, Math.max(1, requestedLevelCount || 1))
  const explicitAssetValues = Object.fromEntries(ASSET_CATALOG.map((entry) => [
    entry.category,
    structuredField(prompt, [entry.label, entry.category]),
  ])) as Partial<Record<AssetCategory, string>>
  const assetValues = Object.fromEntries(ASSET_CATALOG.map((entry) => [
    entry.category,
    explicitAssetValues[entry.category] || entry.defaultPrompt,
  ])) as Partial<Record<AssetCategory, string>>

  const world = structuredField(prompt, ['世界观与故事', '世界观', 'world'])
    || section(prompt, ['world', '世界'], prompt || 'A mysterious original fantasy pixel world with readable platforming spaces.')
  const heroAppearance = explicitAssetValues.hero
    || section(prompt, ['character', 'hero', '主角', '人物'], assetValues.hero || 'A brave side-view adult adventurer with a strong silhouette and practical travel armor.')
  const enemyAppearance = explicitAssetValues.groundEnemy
    || section(prompt, ['enemy', 'enemies', '敌人', '怪物'], assetValues.groundEnemy || 'A hostile original creature with a readable side-view combat silhouette.')
  const meleeWeapon = explicitAssetValues.meleeWeapon || assetValues.meleeWeapon || 'One compact original melee weapon.'
  const rangedWeapon = explicitAssetValues.rangedWeapon || assetValues.rangedWeapon || 'One compact original ranged weapon.'
  const weaponAppearance = `${meleeWeapon} Ranged companion: ${rangedWeapon}`
  const ground = explicitAssetValues.groundPlatform
    || section(prompt, ['ground texture', 'ground', '地面'], assetValues.groundPlatform || 'A seamless side-view stone-and-soil platform texture.')
  const obstacle = explicitAssetValues.normalObstacle
    || section(prompt, ['obstacle', '障碍物'], assetValues.normalObstacle || 'A solid themed blocking object with a simple collision-friendly silhouette.')
  const bossAppearance = explicitAssetValues.boss
    || section(prompt, ['boss', '首领'], assetValues.boss || `A towering original guardian evolved from the world's hostile creatures: ${enemyAppearance}`)
  const collectibleAppearance = explicitAssetValues.collectible
    || section(prompt, ['collectible', 'collectibles', '收集品'], assetValues.collectible || 'A luminous crystal pickup with a compact readable silhouette.')
  const projectile = explicitAssetValues.rangedProjectile
    || section(prompt, ['projectile', '弹射物'], assetValues.rangedProjectile || 'A small bright horizontal energy bolt matching the ranged weapon palette.')
  const attackEffect = explicitAssetValues.meleeAttackEffect
    || section(prompt, ['attack effect', '攻击特效'], assetValues.meleeAttackEffect || 'A compact crescent slash effect with transparent surroundings.')
  const backgroundStory = structuredField(prompt, ['背景故事', 'background story', 'story'])
    || section(prompt, ['background story', 'story', '背景故事'], `Long ago, ${themeName || 'this pixel world'} was protected by the power sealed inside the ${collectibleAppearance}. When ${bossAppearance} shattered that balance, a lone adventurer carrying original weapons set out to reconnect the lost regions, recover the scattered energy, and defeat the final guardian.`)
  const levelMentions: string[] = []

  const levels: LevelSpec[] = Array.from({ length: levelCount }, (_, index) => {
    const block = parsedLevelBlock(prompt, index)
    const environment = levelField(block, ['背景', 'background'])
      || levelDescription(prompt, index, `${world} — region ${index + 1}, with progressively stronger atmosphere and clear traversal lanes.`)
    const platformText = levelField(block, ['平台类型', 'platform type'])
    const levelObstacle = levelField(block, ['障碍物', 'obstacles']) || obstacle
    const musicText = levelField(block, ['背景音乐', 'music'])
    const effectsText = levelField(block, ['天气/滤镜/闪光', '关卡特效', 'effects'])
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
      enemyCount: Math.min(10, 3 + index * 2),
      collectibleCount: Math.min(8, 3 + index),
      hasBoss: index === levelCount - 1,
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

  return {
    version: 3,
    title: structuredField(prompt, ['游戏标题', 'game title']) || themeName.trim() || 'Pixel World',
    world,
    backgroundStory,
    visualStyle: {
      artDirection: visualStyle || 'Original cohesive 16-bit side-scrolling pixel art, crisp hard pixel edges, no antialiasing.',
      palette: 'One unified high-contrast palette with dark atmospheric shadows and vivid gameplay accents.',
      lighting: 'Consistent light from the upper left with readable silhouettes.',
      pixelScale: 'Consistent 2x pixel scale and side-view orthographic camera.',
    },
    hero: { name: 'Hero', appearance: heroAppearance, maxHealth: 100, moveSpeed: 5, jumpPower: 15 },
    weapon: { name: 'Seedblade', appearance: weaponAppearance, mode: 'hybrid', meleeDamage: 24, rangedDamage: 16, cooldownMs: 380, projectileSpeed: 10 },
    enemies: [{ name: 'World Stalker', appearance: enemyAppearance, health: 48, damage: 12, speed: 1.4, behavior: 'chase' }],
    boss: { name: 'World Guardian', appearance: bossAppearance, health: 280, damage: 20, speed: 1.1, attackPattern: 'Alternates between pursuit, projectiles, and an enraged final phase.' },
    collectible: { name: 'Inner Seed', appearance: collectibleAppearance, effect: 'score', value: 100 },
    projectile,
    attackEffect,
    levels,
    assets,
  }
}

/** Keep every user-filled structured field attached to its exact category. */
export function preserveExplicitPromptFields(spec: GameSpec, fallback: GameSpec, sourcePrompt: string): GameSpec {
  const explicitCategories = new Map<AssetCategory, string>()
  for (const entry of ASSET_CATALOG) {
    const value = structuredField(sourcePrompt, [entry.label, entry.category])
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
    world: exact(['世界观与故事', '世界观', 'world']) ? fallback.world : spec.world,
    backgroundStory: exact(['背景故事', 'background story', 'story']) ? fallback.backgroundStory : spec.backgroundStory,
    visualStyle: exact(['整体像素风格', '视觉风格', 'visual style']) ? fallback.visualStyle : spec.visualStyle,
    hero: explicitCategories.has('hero') ? { ...spec.hero, appearance: fallback.hero.appearance } : spec.hero,
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

export function normalizeGameSpec(candidate: unknown, fallback: GameSpec, requestedLevelCount = fallback.levels.length): GameSpec {
  const input = candidate && typeof candidate === 'object' ? candidate as Partial<GameSpec> : {}
  const visual = input.visualStyle as Partial<VisualStyleSpec> | undefined
  const hero = input.hero as Partial<HeroSpec> | undefined
  const weapon = input.weapon as Partial<WeaponSpec> | undefined
  const boss = input.boss as Partial<BossSpec> | undefined
  const collectible = input.collectible as Partial<CollectibleSpec> | undefined
  const count = Math.min(10, Math.max(1, requestedLevelCount || fallback.levels.length))
  const rawEnemies = Array.isArray(input.enemies) ? input.enemies : fallback.enemies
  const rawLevels = Array.isArray(input.levels) ? input.levels : fallback.levels

  const enemies: EnemySpec[] = rawEnemies.slice(0, 8).map((raw, index) => {
    const enemy = raw as Partial<EnemySpec>
    const base = fallback.enemies[Math.min(index, fallback.enemies.length - 1)]
    return {
      name: text(enemy.name, base.name),
      appearance: text(enemy.appearance, base.appearance),
      health: bounded(enemy.health, base.health, 10, 300),
      damage: bounded(enemy.damage, base.damage, 1, 80),
      speed: bounded(enemy.speed, base.speed, 0.4, 5),
      behavior: ['patrol', 'chase', 'ranged'].includes(String(enemy.behavior)) ? enemy.behavior as EnemySpec['behavior'] : base.behavior,
    }
  })

  const levels: LevelSpec[] = Array.from({ length: count }, (_, index) => {
    const raw = (rawLevels[index] || rawLevels[rawLevels.length - 1] || fallback.levels[0]) as Partial<LevelSpec>
    const base = fallback.levels[Math.min(index, fallback.levels.length - 1)] || fallback.levels[0]
    const environment = text(raw.environment, base.environment)
    const defaults = levelDefaults(index, count, environment)
    return {
      id: text(raw.id, `level-${index + 1}`),
      name: text(raw.name, `Level ${index + 1}`),
      environment,
      ground: text(raw.ground, base.ground),
      obstacle: text(raw.obstacle, base.obstacle),
      enemyCount: bounded(raw.enemyCount, base.enemyCount, 0, 12),
      collectibleCount: bounded(raw.collectibleCount, base.collectibleCount, 0, 10),
      hasBoss: index === count - 1 || Boolean(raw.hasBoss),
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
    return { ...required, ...providedAssets[matchIndex] }
  })
  providedAssets.forEach((asset, index) => {
    if (!consumed.has(index) && asset && ASSET_CATALOG.some((entry) => entry.category === asset.category)) rawAssets.push(asset)
  })
  const knownLevels = new Set(levels.map((level) => level.id))
  const assets: AssetDefinition[] = rawAssets.map((rawAsset, index) => {
    const asset = rawAsset as Partial<AssetDefinition>
    const base = defaultAssets.find((item) => item.category === asset.category) || defaultAssets[index % defaultAssets.length]
    const validLevelIds = Array.isArray(asset.levelIds) ? asset.levelIds.filter((id): id is string => typeof id === 'string' && knownLevels.has(id)) : base.levelIds
    const url = text(asset.url, '')
    const kind = ['image', 'spriteSheet', 'audio', 'runtime'].includes(String(asset.kind)) ? asset.kind as AssetDefinition['kind'] : base.kind
    const animation = kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation || base.animation) : undefined
    const animationComplete = animation?.layoutVersion === 3 && animation.clips
      ? ANIMATION_CLIP_POSES.filter((pose) => animation.clips?.[pose]?.enabled !== false).every((pose) => Boolean(animation.clips?.[pose]?.url))
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
      prompt: text(asset.prompt, base.prompt),
      enabled: typeof asset.enabled === 'boolean' ? asset.enabled : base.enabled,
      levelIds: validLevelIds.length ? validLevelIds : base.levelIds,
      kind,
      status,
      url: url || undefined,
      error: text(asset.error, '') || undefined,
      animation,
      sound: asset.sound || base.sound,
      motion: asset.motion || base.motion,
    }
  })

  return {
    version: 3,
    title: text(input.title, fallback.title),
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
  }
}

export function serializeGameSpec(spec: GameSpec): string {
  const assets = spec.assets.map((asset) => `${asset.title}：${asset.prompt}`).join('\n')
  const levels = spec.levels.map((level, index) => `关卡 ${index + 1}：${level.name}\n背景：${level.environment}\n平台类型：${level.platformMode}\n障碍物：${level.obstacle}\n敌人数：${level.enemyCount}\n收集品数：${level.collectibleCount}\n背景音乐：${level.music.tempo} BPM\n天气/滤镜/闪光：${level.effects.weather} / ${level.effects.filter} / ${level.effects.flash ? 'yes' : 'no'}\nBOSS：${level.hasBoss ? 'yes' : 'no'}`).join('\n\n')
  return `游戏标题：${spec.title}\n世界观与故事：${spec.world}\n背景故事：${spec.backgroundStory}\n整体像素风格：${spec.visualStyle.artDirection} ${spec.visualStyle.palette} ${spec.visualStyle.lighting} ${spec.visualStyle.pixelScale}\n主角：${spec.hero.name} — ${spec.hero.appearance}\n近战/远程武器：${spec.weapon.name} — ${spec.weapon.appearance}\n\n${assets}\n\n${levels}`
}
