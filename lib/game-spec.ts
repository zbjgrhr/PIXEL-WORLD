import { createAssetPlan } from '@/lib/asset-catalog'
import type {
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

function customizeAssetPrompts(assets: AssetDefinition[], levels: LevelSpec[], values: Record<string, string>): AssetDefinition[] {
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
    return { ...asset, prompt: values[asset.category] || asset.prompt }
  })
}

export function createFallbackGameSpec(sourcePrompt: string, themeName = 'Pixel World', requestedLevelCount = 3): GameSpec {
  const prompt = sourcePrompt.trim()
  const levelCount = Math.min(10, Math.max(1, requestedLevelCount || 1))
  const world = section(prompt, ['background', 'world', '背景', '世界'], prompt || 'A mysterious fantasy pixel world with readable platforming spaces.')
  const heroAppearance = section(prompt, ['character', 'hero', '主角', '人物'], 'A brave side-view adventurer with a strong silhouette and practical travel armor.')
  const enemyAppearance = section(prompt, ['enemy', 'enemies', '敌人', '怪物'], 'A hostile themed creature with a readable side-view combat silhouette.')
  const weaponAppearance = section(prompt, ['weapon', '武器'], 'A compact enchanted blade paired with a matching ranged energy launcher.')
  const ground = section(prompt, ['ground texture', 'ground', '地面'], 'A seamless side-view stone-and-soil platform texture.')
  const obstacle = section(prompt, ['obstacle', '障碍物'], 'A solid themed blocking object with a simple collision-friendly silhouette.')
  const bossAppearance = section(prompt, ['boss', '首领'], `A towering elite guardian evolved from the world's hostile creatures: ${enemyAppearance}`)
  const collectibleAppearance = section(prompt, ['collectible', 'collectibles', '收集品'], 'A luminous crystal seed pickup with a compact readable silhouette.')
  const projectile = section(prompt, ['projectile', '弹射物'], 'A small bright horizontal energy bolt matching the ranged weapon palette.')
  const attackEffect = section(prompt, ['attack effect', '攻击特效'], 'A compact crescent slash effect with transparent surroundings.')
  const backgroundStory = section(prompt, ['background story', 'story', '背景故事'], `Long ago, ${themeName || 'this pixel world'} was protected by the power sealed inside the ${collectibleAppearance}. When ${bossAppearance} shattered that balance, a lone adventurer carrying ${weaponAppearance} set out to reconnect the lost regions, recover the scattered energy, and defeat the final guardian.`)

  const levels: LevelSpec[] = Array.from({ length: levelCount }, (_, index) => {
    const environment = levelDescription(prompt, index, `${world} — region ${index + 1}, with progressively stronger atmosphere and clear traversal lanes.`)
    return {
      id: `level-${index + 1}`,
      name: `Level ${index + 1}`,
      environment,
      ground,
      obstacle,
      enemyCount: Math.min(10, 3 + index * 2),
      collectibleCount: Math.min(8, 3 + index),
      hasBoss: index === levelCount - 1,
      ...levelDefaults(index, levelCount, environment),
    }
  })

  const assets = customizeAssetPrompts(createAssetPlan(levels.map((level) => level.id)), levels, {
    hero: heroAppearance,
    groundEnemy: enemyAppearance,
    boss: bossAppearance,
    meleeWeapon: weaponAppearance,
    rangedWeapon: `A ranged companion weapon matching ${weaponAppearance}`,
    rangedProjectile: projectile,
    meleeAttackEffect: attackEffect,
    collectible: collectibleAppearance,
    groundPlatform: ground,
    normalObstacle: obstacle,
  })

  return {
    version: 3,
    title: themeName.trim() || 'Pixel World',
    world,
    backgroundStory,
    visualStyle: {
      artDirection: 'Cohesive 16-bit side-scrolling pixel art, crisp hard pixel edges, no antialiasing.',
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
  const rawAssets = Array.isArray(input.assets) && input.assets.length ? input.assets : fallback.assets || defaultAssets
  const knownLevels = new Set(levels.map((level) => level.id))
  const assets: AssetDefinition[] = rawAssets.map((rawAsset, index) => {
    const asset = rawAsset as Partial<AssetDefinition>
    const base = defaultAssets.find((item) => item.category === asset.category) || defaultAssets[index % defaultAssets.length]
    const validLevelIds = Array.isArray(asset.levelIds) ? asset.levelIds.filter((id): id is string => typeof id === 'string' && knownLevels.has(id)) : base.levelIds
    const url = text(asset.url, '')
    return {
      ...base,
      id: text(asset.id, `${base.category}-${index + 1}`),
      title: text(asset.title, base.title),
      prompt: text(asset.prompt, base.prompt),
      enabled: typeof asset.enabled === 'boolean' ? asset.enabled : base.enabled,
      levelIds: validLevelIds.length ? validLevelIds : base.levelIds,
      kind: ['image', 'spriteSheet', 'audio', 'runtime'].includes(String(asset.kind)) ? asset.kind as AssetDefinition['kind'] : base.kind,
      status: url ? 'success' : base.kind === 'audio' || base.kind === 'runtime' ? 'success' : 'pending',
      url: url || undefined,
      error: text(asset.error, '') || undefined,
      animation: asset.animation || base.animation,
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
