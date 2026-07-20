import type { GameTheme } from '@/lib/theme-utils'
import type { ProviderId } from '@/lib/image-providers/types'

export type { ProviderId }
export type { GameTheme } from '@/lib/theme-utils'

export const ASSET_TYPES = [
  'character',
  'background',
  'ground',
  'obstacle',
  'enemy',
  'weapon',
  'projectile',
  'attackEffect',
  'collectible',
  'boss',
] as const

export type AssetType = (typeof ASSET_TYPES)[number]
export type CombatMode = 'melee' | 'ranged' | 'hybrid'

export const ASSET_CATEGORIES = [
  'hero',
  'groundEnemy', 'groundEnemyAttackEffect', 'groundEnemyMotion', 'groundEnemyAttackSound', 'groundEnemyMoveSound',
  'airEnemy', 'airEnemyAttackEffect', 'airEnemyMotion', 'airEnemyAttackSound', 'airEnemyMoveSound',
  'waterEnemy', 'waterEnemyAttackEffect', 'waterEnemyMotion', 'waterEnemyAttackSound', 'waterEnemyMoveSound',
  'boss', 'bossAttackEffect', 'bossMotion', 'bossAttackSound', 'bossMoveSound',
  'meleeWeapon', 'rangedWeapon', 'meleeAttackEffect', 'meleeAttackSound',
  'rangedProjectile', 'rangedAttackEffect', 'rangedAttackSound',
  'collectible',
  'groundPlatform', 'waterPlatform', 'airPlatform',
  'deathObstacle', 'bounceObstacle', 'normalObstacle',
  'levelBackground', 'levelMusic', 'levelEffect',
] as const

export type AssetCategory = (typeof ASSET_CATEGORIES)[number]
export type AssetKind = 'image' | 'spriteSheet' | 'audio' | 'runtime'
export type AssetStatus = 'pending' | 'generating' | 'success' | 'failed' | 'cancelled'
export type EnemyMobility = 'ground' | 'air' | 'water' | 'boss'
export type PlatformMode = 'ground' | 'water' | 'air'

export interface AnimationSpec {
  columns: 6
  rows: 5
  fps: number
  states: Record<'idle' | 'move' | 'attack' | 'hit' | 'death', number>
}

export interface SoundSpec {
  waveform: OscillatorType
  frequency: number
  durationMs: number
  volume: number
  noise: number
  pitchSweep: number
}

export interface MotionSpec {
  mobility: EnemyMobility
  pattern: 'patrol' | 'chase' | 'ranged' | 'hover' | 'dive' | 'swim' | 'phase'
  amplitude: number
  frequency: number
}

export interface AssetDefinition {
  id: string
  category: AssetCategory
  title: string
  prompt: string
  enabled: boolean
  levelIds: string[]
  kind: AssetKind
  status: AssetStatus
  url?: string
  error?: string
  animation?: AnimationSpec
  sound?: SoundSpec
  motion?: MotionSpec
}

export interface MusicSpec {
  tempo: number
  rootFrequency: number
  waveform: OscillatorType
  scale: number[]
  intensity: number
}

export interface LevelEffectSpec {
  weather: 'none' | 'rain' | 'snow' | 'embers' | 'mist' | 'stars'
  filter: 'none' | 'cold' | 'warm' | 'dream' | 'danger' | 'underwater'
  flash: boolean
  intensity: number
}

export interface VisualStyleSpec {
  artDirection: string
  palette: string
  lighting: string
  pixelScale: string
}

export interface HeroSpec {
  name: string
  appearance: string
  maxHealth: number
  moveSpeed: number
  jumpPower: number
}

export interface WeaponSpec {
  name: string
  appearance: string
  mode: CombatMode
  meleeDamage: number
  rangedDamage: number
  cooldownMs: number
  projectileSpeed: number
}

export interface EnemySpec {
  name: string
  appearance: string
  health: number
  damage: number
  speed: number
  behavior: 'patrol' | 'chase' | 'ranged'
}

export interface BossSpec {
  name: string
  appearance: string
  health: number
  damage: number
  speed: number
  attackPattern: string
}

export interface CollectibleSpec {
  name: string
  appearance: string
  effect: 'score' | 'heal' | 'power'
  value: number
}

export interface LevelSpec {
  id: string
  name: string
  environment: string
  ground: string
  obstacle: string
  enemyCount: number
  collectibleCount: number
  hasBoss: boolean
  platformMode: PlatformMode
  music: MusicSpec
  effects: LevelEffectSpec
}

export interface GameSpec {
  version: 3
  title: string
  world: string
  backgroundStory: string
  visualStyle: VisualStyleSpec
  hero: HeroSpec
  weapon: WeaponSpec
  enemies: EnemySpec[]
  boss: BossSpec
  collectible: CollectibleSpec
  projectile: string
  attackEffect: string
  levels: LevelSpec[]
  assets: AssetDefinition[]
}

export interface Theme {
  id: GameTheme
  name: string
  description: string
  characterImage: string
  backgroundImage: string
  groundImage: string
  obstacleImage: string
  enemyImage?: string
  weaponImage?: string
  projectileImage?: string
  attackEffectImage?: string
  collectibleImage?: string
  bossImage?: string
  spec?: GameSpec
  isLoading?: boolean
}

export interface ObstacleData {
  id: string
  x: number
  y: number
  width: number
  height: number
  type: string
}

export interface SpawnPoint {
  id: string
  x: number
  y: number
  kind: string
}

export interface LevelData {
  id: string
  backgroundUrl: string
  groundUrl?: string
  obstacleUrl?: string
  obstacles: ObstacleData[]
  enemySpawns: SpawnPoint[]
  collectibleSpawns: SpawnPoint[]
  bossSpawn?: SpawnPoint
}

export interface GameAssets {
  characterUrl: string
  enemyUrl: string
  weaponUrl: string
  projectileUrl: string
  attackEffectUrl: string
  collectibleUrl: string
  bossUrl: string
}

export interface GameData {
  success?: boolean
  data?: GameAssets & {
    levels: LevelData[]
    spec: GameSpec
  }
  generationId?: string
  timestamp?: string
}

export interface ProjectHeaderProps {
  className?: string
}

export interface ModelSelectorProps {
  selectedProvider: ProviderId
  onProviderChange: (provider: ProviderId) => void
  selectedModel: string
  onModelChange: (model: string) => void
  apiKey: string
  onApiKeyChange: (apiKey: string) => void
}

export interface GenerateImageRequest {
  theme: string
  prompt: string
  provider: ProviderId
  model: string
  types: readonly AssetType[]
  levelCount?: number
  apiKey: string
  spec?: GameSpec
  asset?: AssetDefinition
  levelIndex?: number
}

export interface ThemeCustomizerProps {
  customThemeName: string
  onThemeNameChange: (name: string) => void
  customPrompt: string
  onPromptChange: (prompt: string) => void
  levelCount?: number
  onLevelCountChange?: (count: number) => void
  onOptimizePrompt?: () => void
  isOptimizing?: boolean
  optimizedSpec?: GameSpec | null
}

export interface ActionButtonsProps {
  isThemeCreated: boolean
  isLoading: boolean
  selectedTheme: string
  customPrompt: string
  customThemeName: string
  apiKey: string
  onCreateTheme: () => void
  onStartGame: () => void
}

export interface ThemesListProps {
  themes: Theme[]
  selectedTheme: GameTheme
  onThemeSelect: (themeId: GameTheme) => void
}

export type RegeneratingImages = Record<AssetType, boolean>

export interface ThemePreviewProps {
  isLoading: boolean
  loadingMessage?: string
  gameData?: GameData
  selectedTheme: GameTheme
  themes: Theme[]
  regeneratingImages?: RegeneratingImages
  apiKey?: string
  onRegenerateImage?: (themeId: string, imageType: AssetType, apiKey: string) => Promise<void>
  regeneratingAssetIds?: string[]
  onRegenerateAsset?: (themeId: string, assetId: string, apiKey: string) => Promise<void>
  onUpdateAsset?: (themeId: string, assetId: string, patch: Partial<AssetDefinition>) => void
  onDeleteTheme?: (themeId: string) => void
}

export interface GameCanvasProps {
  loadingProgress?: number
  loadingMessage?: string
  onBackToMenu?: () => void
}

export interface MenuProps {
  className?: string
}

export type ThemeSelectHandler = (themeId: GameTheme) => void
export type ThemeCreateHandler = () => Promise<void>
export type GameStartHandler = () => void
