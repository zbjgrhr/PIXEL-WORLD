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
  name: string
  environment: string
  ground: string
  obstacle: string
  enemyCount: number
  collectibleCount: number
  hasBoss: boolean
}

export interface GameSpec {
  version: 2
  title: string
  world: string
  visualStyle: VisualStyleSpec
  hero: HeroSpec
  weapon: WeaponSpec
  enemies: EnemySpec[]
  boss: BossSpec
  collectible: CollectibleSpec
  projectile: string
  attackEffect: string
  levels: LevelSpec[]
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
