import type { AssetDefinition, AssetType, GameSpec, ProviderId } from '@/types'
import { ASSET_CATALOG_BY_CATEGORY } from '@/lib/asset-catalog'

export type GameAssetType = AssetType
export type CutoutMode = 'checkerboard' | 'chroma-green'

const COMMON_STYLE = '2D side-scrolling game asset, cohesive 16-bit pixel art, crisp hard pixel edges, no antialiasing, orthographic side view, game-ready readability'
const ISOLATED_BASE = 'exactly one isolated subject, centered, fully visible, generous empty margin, no crop, no text, no logo, no UI, no frame, no border, no scene'
const SCENE_NEGATIVE = 'people, characters, hero, enemies, monsters, creatures, weapons, pickups, obstacles in foreground, UI, text, logo, border, frame'
const SPRITE_NEGATIVE = 'environment, scenery, landscape, sky, ground, floor, platform, architecture, buildings, trees, plants, furniture, multiple subjects, duplicate subject, border, frame, card, UI panel, text, logo, watermark, cast shadow extending into a scene'
const ORIGINALITY = 'original non-branded design, no recognizable franchise character, no trademarked symbol'

function cleanPromptFragment(value: string, maxLength = 700): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\b(?:in the style of|style of|inspired by|based on)\s+[^,.;\n]{1,80}/gi, 'with an original genre-appropriate design')
    .replace(/(?:模仿|仿照|参考|致敬)\s*[^，。；;\n]{1,40}/g, '采用原创同类设计')
    .replace(/《[^》]{1,80}》/g, '原创作品')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

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
  return cleanPromptFragment(`${visual.artDirection}; ${visual.palette}; ${visual.lighting}; ${visual.pixelScale}`, 500)
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
      return `${isolated}, one compact combat visual effect only, clear horizontal direction, no character, no weapon`
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
  const requestedAsset = cleanPromptFragment(asset.prompt)
  if (asset.kind === 'spriteSheet') {
    return `${COMMON_STYLE}. ${ORIGINALITY}. Shared visual contract: ${sharedStyle}. This asset only: ${requestedAsset}. Create one exact 6-column by 5-row animation sprite sheet on ${isolationBackground(providerId, model)}. Row 1 idle animation, row 2 movement animation, row 3 attack animation, row 4 hit reaction, row 5 defeat animation. Exactly 30 equally sized cells, consistent character proportions and colors in every cell, full body visible, side view, no labels, no letters, no numbers, no grid lines, no scenery, no separate weapon, no extra character.`
  }
  const base = getPositiveTemplate(generationType, providerId, model)
  return `${base}. ${ORIGINALITY}. Shared visual contract: ${sharedStyle}. This asset only: ${requestedAsset}. Generate only this one category and never merge it with a character, scene, weapon, creature, platform, obstacle, projectile, pickup, or effect from another category.`
}

/** A deliberately generic second attempt for provider moderation false positives. */
export function buildModerationSafePlannedAssetPrompt(
  asset: AssetDefinition,
  generationType: AssetType,
  providerId: ProviderId,
  model?: string,
): string {
  const catalogPrompt = cleanPromptFragment(ASSET_CATALOG_BY_CATEGORY[asset.category]?.defaultPrompt || asset.prompt, 240)
  const base = getPositiveTemplate(generationType, providerId, model)
  if (asset.kind === 'spriteSheet') {
    return `${COMMON_STYLE}. ${ORIGINALITY}. ${catalogPrompt}. One exact 6-column by 5-row side-view animation sprite sheet on ${isolationBackground(providerId, model)}. Rows: idle, movement, attack, hit reaction, defeat. Exactly 30 equal cells, one consistent original subject, full body visible, no names, no story, no text, no logo, no scenery, no extra subject.`
  }
  return `${base}. ${ORIGINALITY}. ${catalogPrompt}. Use a simple dark-neutral and cyan-orange pixel palette. One asset only, no names, no story, no text, no logo, no mixed categories.`
}
