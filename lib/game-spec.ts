import type {
  BossSpec,
  CollectibleSpec,
  EnemySpec,
  GameSpec,
  HeroSpec,
  LevelSpec,
  VisualStyleSpec,
  WeaponSpec,
} from '@/types'

const LABELS = [
  'background', '背景', 'world', '世界', 'character', 'hero', '主角', '人物',
  'enemy', 'enemies', '敌人', '怪物', 'weapon', '武器', 'ground texture',
  'ground', '地面', 'obstacle', '障碍物', 'boss', '首领', 'collectible',
  'collectibles', '收集品', 'projectile', '弹射物', 'attack effect', '攻击特效',
]

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function section(source: string, aliases: string[], fallback: string): string {
  const escaped = LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  for (const alias of aliases) {
    const key = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(
      `(?:^|[\\n。；;])\\s*${key}\\s*(?:is|是)?\\s*[:：=]?\\s*([\\s\\S]*?)(?=(?:[\\n。；;])\\s*(?:${escaped})\\s*(?:is|是)?\\s*[:：=]?|$)`,
      'i',
    )
    const match = source.match(pattern)
    if (match?.[1]?.trim()) return match[1].trim().replace(/\n+/g, ' ')
  }
  return fallback
}

function levelDescription(source: string, index: number, fallback: string): string {
  const level = index + 1
  const match = source.match(
    new RegExp(`(?:LEVEL|关卡)\\s*${level}[^\\n]*[:：-]?\\s*([\\s\\S]*?)(?=(?:LEVEL|关卡)\\s*${level + 1}|$)`, 'i'),
  )
  return match?.[1]?.trim().replace(/\n+/g, ' ') || fallback
}

export function createFallbackGameSpec(
  sourcePrompt: string,
  themeName = 'Pixel World',
  requestedLevelCount = 3,
): GameSpec {
  const prompt = sourcePrompt.trim()
  const levelCount = Math.min(10, Math.max(1, requestedLevelCount || 1))
  const world = section(
    prompt,
    ['background', '背景', 'world', '世界'],
    prompt || 'A mysterious fantasy pixel world with readable platforming spaces.',
  )
  const heroAppearance = section(
    prompt,
    ['character', 'hero', '主角', '人物'],
    'A brave side-view adventurer with a strong silhouette and practical travel armor.',
  )
  const enemyAppearance = section(
    prompt,
    ['enemy', 'enemies', '敌人', '怪物'],
    'A hostile themed creature with a readable side-view combat silhouette.',
  )
  const weaponAppearance = section(
    prompt,
    ['weapon', '武器'],
    'A compact enchanted blade paired with a matching ranged energy launcher.',
  )
  const ground = section(
    prompt,
    ['ground texture', 'ground', '地面'],
    'A seamless side-view stone-and-soil platform texture.',
  )
  const obstacle = section(
    prompt,
    ['obstacle', '障碍物'],
    'A solid themed blocking object with a simple collision-friendly silhouette.',
  )
  const bossAppearance = section(
    prompt,
    ['boss', '首领'],
    `A towering elite guardian evolved from the world's hostile creatures: ${enemyAppearance}`,
  )
  const collectibleAppearance = section(
    prompt,
    ['collectible', 'collectibles', '收集品'],
    'A luminous crystal seed pickup with a compact readable silhouette.',
  )

  return {
    version: 2,
    title: themeName.trim() || 'Pixel World',
    world,
    visualStyle: {
      artDirection: 'Cohesive 16-bit side-scrolling pixel art, crisp hard pixel edges, no antialiasing.',
      palette: 'One unified high-contrast palette with dark atmospheric shadows and vivid gameplay accents.',
      lighting: 'Consistent light from the upper left with readable silhouettes.',
      pixelScale: 'Consistent 2x pixel scale and side-view orthographic camera.',
    },
    hero: {
      name: 'Hero',
      appearance: heroAppearance,
      maxHealth: 100,
      moveSpeed: 5,
      jumpPower: 15,
    },
    weapon: {
      name: 'Seedblade',
      appearance: weaponAppearance,
      mode: 'hybrid',
      meleeDamage: 24,
      rangedDamage: 16,
      cooldownMs: 380,
      projectileSpeed: 10,
    },
    enemies: [{
      name: 'World Stalker',
      appearance: enemyAppearance,
      health: 48,
      damage: 12,
      speed: 1.4,
      behavior: 'chase',
    }],
    boss: {
      name: 'World Guardian',
      appearance: bossAppearance,
      health: 280,
      damage: 20,
      speed: 1.1,
      attackPattern: 'Alternates between pursuit, contact attacks, and aimed energy projectiles.',
    },
    collectible: {
      name: 'Inner Seed',
      appearance: collectibleAppearance,
      effect: 'score',
      value: 100,
    },
    projectile: section(
      prompt,
      ['projectile', '弹射物'],
      'A small bright horizontal energy bolt matching the weapon palette.',
    ),
    attackEffect: section(
      prompt,
      ['attack effect', '攻击特效'],
      'A compact crescent slash effect with transparent surroundings.',
    ),
    levels: Array.from({ length: levelCount }, (_, index): LevelSpec => ({
      name: `Level ${index + 1}`,
      environment: levelDescription(prompt, index, `${world} — region ${index + 1}, with progressively stronger atmosphere and clearer traversal lanes.`),
      ground,
      obstacle,
      enemyCount: Math.min(10, 3 + index * 2),
      collectibleCount: Math.min(8, 3 + index),
      hasBoss: index === levelCount - 1,
    })),
  }
}

export function normalizeGameSpec(
  candidate: unknown,
  fallback: GameSpec,
  requestedLevelCount = fallback.levels.length,
): GameSpec {
  const input = candidate && typeof candidate === 'object' ? candidate as Partial<GameSpec> : {}
  const visual = input.visualStyle as Partial<VisualStyleSpec> | undefined
  const hero = input.hero as Partial<HeroSpec> | undefined
  const weapon = input.weapon as Partial<WeaponSpec> | undefined
  const boss = input.boss as Partial<BossSpec> | undefined
  const collectible = input.collectible as Partial<CollectibleSpec> | undefined
  const count = Math.min(10, Math.max(1, requestedLevelCount || fallback.levels.length))
  const rawEnemies = Array.isArray(input.enemies) ? input.enemies : fallback.enemies
  const rawLevels = Array.isArray(input.levels) ? input.levels : fallback.levels

  const enemies: EnemySpec[] = rawEnemies.slice(0, 4).map((raw, index) => {
    const enemy = raw as Partial<EnemySpec>
    const base = fallback.enemies[Math.min(index, fallback.enemies.length - 1)]
    const behavior = ['patrol', 'chase', 'ranged'].includes(String(enemy.behavior))
      ? enemy.behavior as EnemySpec['behavior']
      : base.behavior
    return {
      name: text(enemy.name, base.name),
      appearance: text(enemy.appearance, base.appearance),
      health: number(enemy.health, base.health, 10, 300),
      damage: number(enemy.damage, base.damage, 1, 80),
      speed: number(enemy.speed, base.speed, 0.4, 5),
      behavior,
    }
  })

  const levels: LevelSpec[] = Array.from({ length: count }, (_, index) => {
    const raw = (rawLevels[index] || rawLevels[rawLevels.length - 1] || fallback.levels[0]) as Partial<LevelSpec>
    const base = fallback.levels[Math.min(index, fallback.levels.length - 1)] || fallback.levels[0]
    return {
      name: text(raw.name, `Level ${index + 1}`),
      environment: text(raw.environment, base.environment),
      ground: text(raw.ground, base.ground),
      obstacle: text(raw.obstacle, base.obstacle),
      enemyCount: number(raw.enemyCount, base.enemyCount, 1, 12),
      collectibleCount: number(raw.collectibleCount, base.collectibleCount, 1, 10),
      hasBoss: index === count - 1,
    }
  })

  return {
    version: 2,
    title: text(input.title, fallback.title),
    world: text(input.world, fallback.world),
    visualStyle: {
      artDirection: text(visual?.artDirection, fallback.visualStyle.artDirection),
      palette: text(visual?.palette, fallback.visualStyle.palette),
      lighting: text(visual?.lighting, fallback.visualStyle.lighting),
      pixelScale: text(visual?.pixelScale, fallback.visualStyle.pixelScale),
    },
    hero: {
      name: text(hero?.name, fallback.hero.name),
      appearance: text(hero?.appearance, fallback.hero.appearance),
      maxHealth: number(hero?.maxHealth, fallback.hero.maxHealth, 40, 300),
      moveSpeed: number(hero?.moveSpeed, fallback.hero.moveSpeed, 2, 9),
      jumpPower: number(hero?.jumpPower, fallback.hero.jumpPower, 8, 24),
    },
    weapon: {
      name: text(weapon?.name, fallback.weapon.name),
      appearance: text(weapon?.appearance, fallback.weapon.appearance),
      mode: ['melee', 'ranged', 'hybrid'].includes(String(weapon?.mode))
        ? weapon?.mode as WeaponSpec['mode']
        : fallback.weapon.mode,
      meleeDamage: number(weapon?.meleeDamage, fallback.weapon.meleeDamage, 5, 100),
      rangedDamage: number(weapon?.rangedDamage, fallback.weapon.rangedDamage, 5, 100),
      cooldownMs: number(weapon?.cooldownMs, fallback.weapon.cooldownMs, 120, 2000),
      projectileSpeed: number(weapon?.projectileSpeed, fallback.weapon.projectileSpeed, 4, 24),
    },
    enemies,
    boss: {
      name: text(boss?.name, fallback.boss.name),
      appearance: text(boss?.appearance, fallback.boss.appearance),
      health: number(boss?.health, fallback.boss.health, 100, 1200),
      damage: number(boss?.damage, fallback.boss.damage, 5, 120),
      speed: number(boss?.speed, fallback.boss.speed, 0.3, 5),
      attackPattern: text(boss?.attackPattern, fallback.boss.attackPattern),
    },
    collectible: {
      name: text(collectible?.name, fallback.collectible.name),
      appearance: text(collectible?.appearance, fallback.collectible.appearance),
      effect: ['score', 'heal', 'power'].includes(String(collectible?.effect))
        ? collectible?.effect as CollectibleSpec['effect']
        : fallback.collectible.effect,
      value: number(collectible?.value, fallback.collectible.value, 1, 1000),
    },
    projectile: text(input.projectile, fallback.projectile),
    attackEffect: text(input.attackEffect, fallback.attackEffect),
    levels,
  }
}

export function serializeGameSpec(spec: GameSpec): string {
  const levels = spec.levels.map((level, index) =>
    `LEVEL ${index + 1} — ${level.name}\nEnvironment: ${level.environment}\nGround: ${level.ground}\nObstacle: ${level.obstacle}\nEnemies: ${level.enemyCount}\nCollectibles: ${level.collectibleCount}\nBoss: ${level.hasBoss ? 'yes' : 'no'}`,
  ).join('\n\n')

  return `TITLE: ${spec.title}\nWORLD: ${spec.world}\nVISUAL STYLE: ${spec.visualStyle.artDirection} ${spec.visualStyle.palette} ${spec.visualStyle.lighting} ${spec.visualStyle.pixelScale}\nHERO: ${spec.hero.name} — ${spec.hero.appearance}\nWEAPON: ${spec.weapon.name} — ${spec.weapon.appearance}; ${spec.weapon.mode}\nENEMY: ${spec.enemies.map((enemy) => `${enemy.name} — ${enemy.appearance}`).join('; ')}\nBOSS: ${spec.boss.name} — ${spec.boss.appearance}; ${spec.boss.attackPattern}\nCOLLECTIBLE: ${spec.collectible.name} — ${spec.collectible.appearance}; effect ${spec.collectible.effect}\nPROJECTILE: ${spec.projectile}\nATTACK EFFECT: ${spec.attackEffect}\n\n${levels}`
}
