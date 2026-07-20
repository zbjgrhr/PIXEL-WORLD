export type GraphicsQuality = 'low' | 'medium' | 'high'
export type DisplaySize = 'compact' | 'standard' | 'expanded'

export interface GameSettings {
  displaySize: DisplaySize
  graphicsQuality: GraphicsQuality
  masterVolume: number
  musicEnabled: boolean
  soundEnabled: boolean
  showDebugInfo: boolean
}

const STORAGE_KEY = 'pixel-world-game-settings'

export const DEFAULT_GAME_SETTINGS: GameSettings = {
  displaySize: 'standard',
  graphicsQuality: 'medium',
  masterVolume: 80,
  musicEnabled: true,
  soundEnabled: true,
  showDebugInfo: false,
}

export function loadGameSettings(): GameSettings {
  if (typeof window === 'undefined') return DEFAULT_GAME_SETTINGS
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GameSettings>
      return {
        ...DEFAULT_GAME_SETTINGS,
        ...parsed,
        displaySize: ['compact', 'standard', 'expanded'].includes(String(parsed.displaySize))
          ? parsed.displaySize as DisplaySize
          : DEFAULT_GAME_SETTINGS.displaySize,
        masterVolume: Number.isFinite(Number(parsed.masterVolume))
          ? Math.min(100, Math.max(0, Number(parsed.masterVolume)))
          : DEFAULT_GAME_SETTINGS.masterVolume,
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_GAME_SETTINGS
}

export function saveGameSettings(settings: GameSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function getGraphicsFilter(quality: GraphicsQuality): string {
  switch (quality) {
    case 'low':
      return 'none'
    case 'high':
      return 'contrast(1.08) saturate(1.12)'
    default:
      return 'contrast(1.02) saturate(1.05)'
  }
}
