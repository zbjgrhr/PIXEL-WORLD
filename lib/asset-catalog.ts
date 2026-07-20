import type {
  AnimationSpec,
  AssetCategory,
  AssetDefinition,
  AssetKind,
  AssetType,
  EnemyMobility,
  MotionSpec,
  SoundSpec,
} from '@/types'

export interface AssetCatalogEntry {
  category: AssetCategory
  label: string
  kind: AssetKind
  generationType?: AssetType
  repeatable?: boolean
  defaultPrompt: string
  mobility?: EnemyMobility
}

const sprite = (category: AssetCategory, label: string, defaultPrompt: string, mobility: EnemyMobility, repeatable = true): AssetCatalogEntry => ({
  category, label, kind: 'spriteSheet', generationType: category === 'hero' ? 'character' : category === 'boss' ? 'boss' : 'enemy', repeatable, defaultPrompt, mobility,
})
const image = (category: AssetCategory, label: string, generationType: AssetType, defaultPrompt: string, repeatable = true): AssetCatalogEntry => ({
  category, label, kind: 'image', generationType, repeatable, defaultPrompt,
})
const audio = (category: AssetCategory, label: string, defaultPrompt: string): AssetCatalogEntry => ({ category, label, kind: 'audio', repeatable: false, defaultPrompt })
const runtime = (category: AssetCategory, label: string, defaultPrompt: string, mobility?: EnemyMobility): AssetCatalogEntry => ({ category, label, kind: 'runtime', repeatable: false, defaultPrompt, mobility })

export const ASSET_CATALOG: AssetCatalogEntry[] = [
  sprite('hero', '主角 / Hero', 'A brave readable side-view protagonist with a distinctive silhouette.', 'ground', false),
  sprite('groundEnemy', '地面敌人 / Ground Enemy', 'A ground-based enemy with a readable combat silhouette.', 'ground'),
  image('groundEnemyAttackEffect', '地面敌人攻击特效', 'attackEffect', 'A compact hostile ground-enemy attack effect.'),
  runtime('groundEnemyMotion', '地面敌人行动形态', 'Patrol, chase, then attack at close range.', 'ground'),
  audio('groundEnemyAttackSound', '地面敌人攻击音效', 'A short sharp hostile strike sound.'),
  audio('groundEnemyMoveSound', '地面敌人行动音效', 'Rhythmic light footsteps matching the creature.'),
  sprite('airEnemy', '空中敌人 / Air Enemy', 'A flying enemy with wings or magical lift and a clear silhouette.', 'air'),
  image('airEnemyAttackEffect', '空中敌人攻击特效', 'projectile', 'A compact aerial enemy projectile pointing horizontally.'),
  runtime('airEnemyMotion', '空中敌人行动形态', 'Hover, patrol in arcs, then dive toward the hero.', 'air'),
  audio('airEnemyAttackSound', '空中敌人攻击音效', 'A bright fast aerial attack sound.'),
  audio('airEnemyMoveSound', '空中敌人行动音效', 'A soft wing or levitation pulse.'),
  sprite('waterEnemy', '水中敌人 / Water Enemy', 'An aquatic enemy designed for side-view swimming.', 'water'),
  image('waterEnemyAttackEffect', '水中敌人攻击特效', 'projectile', 'A compact bubble, jet, or aquatic projectile.'),
  runtime('waterEnemyMotion', '水中敌人行动形态', 'Swim in waves and pursue slowly inside water zones.', 'water'),
  audio('waterEnemyAttackSound', '水中敌人攻击音效', 'A muffled watery impact sound.'),
  audio('waterEnemyMoveSound', '水中敌人行动音效', 'A gentle bubbling swim sound.'),
  sprite('boss', 'BOSS', 'An imposing oversized boss with a strong final-arena silhouette.', 'boss'),
  image('bossAttackEffect', 'BOSS攻击特效', 'attackEffect', 'A large dramatic boss attack effect with transparent surroundings.'),
  runtime('bossMotion', 'BOSS行动形态', 'Multi-phase pursuit, projectile volleys, and a final enraged phase.', 'boss'),
  audio('bossAttackSound', 'BOSS攻击音效', 'A deep layered boss attack sound.'),
  audio('bossMoveSound', 'BOSS行动音效', 'Heavy ominous movement pulses.'),
  image('meleeWeapon', '近战武器', 'weapon', 'One isolated melee weapon, horizontal side view.'),
  image('rangedWeapon', '远程武器', 'weapon', 'One isolated ranged weapon, horizontal side view.'),
  image('meleeAttackEffect', '近战攻击特效', 'attackEffect', 'A compact crescent melee slash effect.'),
  audio('meleeAttackSound', '近战攻击音效', 'A crisp melee swing and impact sound.'),
  image('rangedProjectile', '远程弹射物', 'projectile', 'A small isolated projectile pointing right.'),
  image('rangedAttackEffect', '远程攻击/命中特效', 'attackEffect', 'A compact muzzle flash and impact burst effect.'),
  audio('rangedAttackSound', '远程攻击音效', 'A short energetic ranged shot sound.'),
  image('collectible', '收集品', 'collectible', 'One glowing collectible pickup icon.'),
  image('groundPlatform', '地面平台', 'ground', 'A seamless solid ground platform texture.', false),
  image('waterPlatform', '水域（低重力）', 'background', 'A side-view water zone overlay with no characters.', false),
  image('airPlatform', '大气（漂浮）', 'obstacle', 'One floating platform with a clear flat top.', false),
  image('deathObstacle', '触碰即死障碍物', 'obstacle', 'One lethal spike or hazard obstacle.', false),
  image('bounceObstacle', '弹跳障碍物', 'obstacle', 'One springy bounce pad obstacle.', false),
  image('normalObstacle', '普通障碍物', 'obstacle', 'One solid collision-friendly obstacle.', false),
  image('levelBackground', '关卡背景', 'background', 'A wide parallax-ready environment background.'),
  audio('levelMusic', '关卡背景音乐', 'A looping theme with a clear mood and progression.'),
  runtime('levelEffect', '关卡特效', 'Weather particles, palette filter, ambient glow, and restrained flashes.'),
]

export const ASSET_CATALOG_BY_CATEGORY = Object.fromEntries(
  ASSET_CATALOG.map((entry) => [entry.category, entry]),
) as Record<AssetCategory, AssetCatalogEntry>

export const DEFAULT_ANIMATION: AnimationSpec = {
  columns: 6,
  rows: 5,
  fps: 8,
  states: { idle: 4, move: 6, attack: 6, hit: 2, death: 6 },
}

function soundFor(category: AssetCategory): SoundSpec {
  const low = category.includes('boss') || category.includes('Move')
  const watery = category.includes('water')
  return {
    waveform: watery ? 'sine' : low ? 'sawtooth' : 'square',
    frequency: watery ? 180 : low ? 110 : 420,
    durationMs: category.includes('Move') ? 120 : 220,
    volume: category.includes('boss') ? 0.32 : 0.2,
    noise: watery ? 0.08 : 0.14,
    pitchSweep: category.includes('Attack') || category.includes('attack') ? -0.35 : 0.08,
  }
}

function motionFor(entry: AssetCatalogEntry): MotionSpec | undefined {
  if (!entry.mobility) return undefined
  const pattern = entry.mobility === 'air' ? 'dive' : entry.mobility === 'water' ? 'swim' : entry.mobility === 'boss' ? 'phase' : 'chase'
  return { mobility: entry.mobility, pattern, amplitude: entry.mobility === 'ground' ? 0 : 42, frequency: entry.mobility === 'boss' ? 0.7 : 1.2 }
}

export function createAssetPlan(levelIds: string[]): AssetDefinition[] {
  let index = 0
  return ASSET_CATALOG.flatMap((entry) => {
    const onlyLast = entry.category === 'boss' || entry.category.startsWith('boss')
    const enabledByDefault = !entry.category.startsWith('water') && !entry.category.startsWith('air')
    const levelSpecific = entry.category === 'levelBackground' || entry.category === 'levelMusic' || entry.category === 'levelEffect'
    const targets = levelSpecific ? levelIds.map((levelId) => [levelId]) : [onlyLast ? levelIds.slice(-1) : [...levelIds]]
    return targets.map((targetIds, targetIndex) => ({
        id: `${entry.category}-${++index}`,
        category: entry.category,
        title: levelSpecific ? `${entry.label} · Level ${targetIndex + 1}` : entry.label,
        prompt: entry.defaultPrompt,
        enabled: enabledByDefault,
        levelIds: targetIds,
        kind: entry.kind,
        status: entry.kind === 'audio' || entry.kind === 'runtime' ? 'success' as const : 'pending' as const,
        animation: entry.kind === 'spriteSheet' ? { ...DEFAULT_ANIMATION, states: { ...DEFAULT_ANIMATION.states } } : undefined,
        sound: entry.kind === 'audio' ? soundFor(entry.category) : undefined,
        motion: motionFor(entry),
      }))
  })
}

export function generationTypeForAsset(asset: AssetDefinition): AssetType | undefined {
  return ASSET_CATALOG_BY_CATEGORY[asset.category]?.generationType
}

export function canDuplicateAsset(category: AssetCategory): boolean {
  return ASSET_CATALOG_BY_CATEGORY[category]?.repeatable !== false
}

export function buildStructuredPrompt(levelCount: number): string {
  const fields = ASSET_CATALOG.map((entry) => `${entry.label}：`).join('\n')
  const levels = Array.from({ length: levelCount }, (_, index) =>
    `关卡 ${index + 1}：\n背景：\n平台类型：\n障碍物：\n出现素材：\n背景音乐：\n天气/滤镜/闪光：`,
  ).join('\n\n')
  return `游戏标题：\n世界观与故事：\n背景故事：\n整体像素风格：\n\n${fields}\n\n${levels}`
}

export function isStructuredPromptBlank(prompt: string): boolean {
  if (!prompt.trim()) return true
  return prompt.split(/\r?\n/).every((line) => {
    const match = line.match(/^[^:：]+[:：](.*)$/)
    return !match || !match[1].trim()
  })
}
