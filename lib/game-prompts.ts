import type { AssetDefinition, AssetType, GameSpec, ProviderId } from '@/types'

export type GameAssetType = AssetType
export type CutoutMode = 'checkerboard' | 'chroma-green'

const COMMON_STYLE = '2D side-scrolling game asset, cohesive 16-bit pixel art, crisp hard pixel edges, no antialiasing, orthographic side view, game-ready readability'
const ISOLATED_BASE = 'exactly one isolated subject, centered, fully visible, generous empty margin, no crop, no text, no logo, no UI, no frame, no border, no scene'
const SCENE_NEGATIVE = 'people, characters, hero, enemies, monsters, creatures, weapons, pickups, obstacles in foreground, UI, text, logo, border, frame'
const SPRITE_NEGATIVE = 'environment, scenery, landscape, sky, ground, floor, platform, architecture, buildings, trees, plants, furniture, multiple subjects, duplicate subject, border, frame, card, UI panel, text, logo, watermark, cast shadow extending into a scene'

function usesChromaKey(providerId: ProviderId, model?: string): boolean {
  if (providerId === 'dashscope') return false
  if (providerId === 'openai') return true
  return providerId === 'openrouter' || Boolean(model && /gpt-image/i.test(model))
}

function isolationBackground(providerId: ProviderId, model?: string): string {
  return usesChromaKey(providerId, model)
    ? 'single uniform bright green chroma-key background #00FF00, edge-to-edge flat green, no checkerboard, no shadow on background'
    : 'plain light-gray and white checkerboard transparency background only, no shadow on background'
}

function style(spec: GameSpec): string {
  const visual = spec.visualStyle
  return `${visual.artDirection}; ${visual.palette}; ${visual.lighting}; ${visual.pixelScale}`
}

export function getCutoutMode(
  providerId: ProviderId,
  type: GameAssetType,
  model?: string,
): CutoutMode | null {
  if (type === 'background' || type === 'ground') return null
  return usesChromaKey(providerId, model) ? 'chroma-green' : 'checkerboard'
}

export function getPositiveTemplate(
  type: GameAssetType,
  providerId: ProviderId,
  model?: string,
): string {
  const isolated = `${COMMON_STYLE}, ${ISOLATED_BASE}, ${isolationBackground(providerId, model)}`
  switch (type) {
    case 'background':
      return `${COMMON_STYLE}, wide 16:9 parallax-ready environment background, clear traversal corridor, atmospheric depth, environment only`
    case 'ground':
      return `${COMMON_STYLE}, seamless tileable side-view ground material texture, texture fills the entire canvas edge-to-edge, one material family only, no empty area`
    case 'character':
      return `${isolated}, one complete player character, facing right, neutral ready stance, strong readable silhouette`
    case 'enemy':
      return `${isolated}, one complete ordinary enemy creature, facing left, aggressive ready stance, clearly different silhouette from player`
    case 'boss':
      return `${isolated}, one complete boss creature, facing left, imposing oversized combat silhouette, no minions`
    case 'weapon':
      return `${isolated}, one weapon only, horizontal side view, no hands, no wielder`
    case 'projectile':
      return `${isolated}, one small horizontal projectile only, pointing right, compact silhouette, no launcher`
    case 'attackEffect':
      return `${isolated}, one compact horizontal melee slash visual effect only, crescent-shaped, no character, no weapon`
    case 'collectible':
      return `${isolated}, one small collectible pickup icon only, readable glowing silhouette, no pedestal`
    case 'obstacle':
      return `${isolated}, one solid collision obstacle only, flat frontal view, simple compact silhouette`
  }
}

export function getNegativeTemplate(
  type: GameAssetType,
  providerId: ProviderId,
  model?: string,
): string {
  const rendering = '3D render, photorealistic, vector art, smooth gradients, blurry, low resolution, antialiasing'
  if (type === 'background') return `${rendering}, ${SCENE_NEGATIVE}`
  if (type === 'ground') {
    return `${rendering}, ${SCENE_NEGATIVE}, sky, horizon, buildings, plants, decorations, transparent area, checkerboard, isolated object, perspective scene, top-down map`
  }
  const providerBackground = usesChromaKey(providerId, model)
    ? 'checkerboard, transparency grid, white background, gray background, gradient background'
    : 'solid green background, white solid background, colored scene background'
  return `${rendering}, ${SPRITE_NEGATIVE}, ${providerBackground}`
}

export function buildGamePrompt(
  type: GameAssetType,
  theme: string,
  spec: GameSpec,
  levelIndex: number,
  providerId: ProviderId,
  model?: string,
): string {
  const base = getPositiveTemplate(type, providerId, model)
  const sharedStyle = style(spec)
  const level = spec.levels[Math.min(levelIndex, spec.levels.length - 1)] || spec.levels[0]
  let subject = ''

  switch (type) {
    case 'background':
      subject = `World identity: ${spec.world}. This level environment only: ${level.environment}. Do not depict the hero, enemies, boss, weapons, collectibles, ground tiles, or isolated obstacles.`
      break
    case 'ground':
      subject = `Ground material only: ${level.ground}. Do not depict scenery, horizon, architecture, characters, creatures, weapons, plants, props, or obstacles.`
      break
    case 'obstacle':
      subject = `Obstacle only: ${level.obstacle}. Do not depict the surrounding world, ground, characters, enemies, weapons, or additional objects.`
      break
    case 'character':
      subject = `Player only: ${spec.hero.name}. Appearance: ${spec.hero.appearance}. Do not depict enemies, weapons as separate objects, scenery, ground, or props.`
      break
    case 'enemy':
      subject = `Ordinary enemy only: ${spec.enemies[0].name}. Appearance: ${spec.enemies[0].appearance}. Do not depict the player, boss, weapon, projectile, scenery, or ground.`
      break
    case 'boss':
      subject = `Boss only: ${spec.boss.name}. Appearance: ${spec.boss.appearance}. Do not depict minions, player, scenery, ground, weapon, projectile, or UI.`
      break
    case 'weapon':
      subject = `Weapon only: ${spec.weapon.name}. Appearance: ${spec.weapon.appearance}. Do not depict a wielder, hands, character, enemy, scene, ground, projectile, or effect.`
      break
    case 'projectile':
      subject = `Projectile only: ${spec.projectile}. Match weapon identity ${spec.weapon.name}, but do not depict the weapon, character, enemy, scenery, impact, or UI.`
      break
    case 'attackEffect':
      subject = `Melee attack effect only: ${spec.attackEffect}. Match weapon identity ${spec.weapon.name}, but do not depict the weapon, character, enemy, projectile, scenery, or UI.`
      break
    case 'collectible':
      subject = `Collectible only: ${spec.collectible.name}. Appearance: ${spec.collectible.appearance}. Do not depict a pedestal, ground, scenery, character, enemy, or other items.`
      break
  }

  return `${base}. Theme label: ${theme}. Shared visual contract: ${sharedStyle}. ${subject}`
}

export function buildPlannedAssetPrompt(
  asset: AssetDefinition,
  generationType: AssetType,
  theme: string,
  spec: GameSpec,
  levelIndex: number,
  providerId: ProviderId,
  model?: string,
): string {
  const sharedStyle = style(spec)
  const level = spec.levels[Math.min(levelIndex, spec.levels.length - 1)] || spec.levels[0]
  if (asset.kind === 'spriteSheet') {
    return `${COMMON_STYLE}. Theme: ${theme}. Shared visual contract: ${sharedStyle}. Character identity: ${asset.prompt}. Create one exact 6-column by 5-row animation sprite sheet on ${isolationBackground(providerId, model)}. Row 1 idle animation, row 2 movement animation, row 3 attack animation, row 4 hit reaction, row 5 death animation. Exactly 30 equally sized cells, consistent character proportions and colors in every cell, full body visible, side view, no labels, no letters, no numbers, no grid lines, no scenery, no weapons floating separately, no extra characters.`
  }
  const base = getPositiveTemplate(generationType, providerId, model)
  const levelContext = asset.levelIds.length === 1 ? `Level context: ${level?.environment || spec.world}.` : ''
  return `${base}. Theme: ${theme}. Shared visual contract: ${sharedStyle}. Requested asset: ${asset.prompt}. ${levelContext} Generate only this asset and never merge it with another category.`
}
