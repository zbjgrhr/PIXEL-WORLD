export type PresetThemeId = 'fantasy' | 'cyberpunk' | 'western-world' | 'underwater-world'

export type GameTheme =
  | PresetThemeId
  | `custom-${string}`
  | `loading-${string}`

export const PRESET_THEME_IDS: PresetThemeId[] = [
  'fantasy',
  'cyberpunk',
  'western-world',
  'underwater-world',
]

export function isCustomTheme(theme: string): boolean {
  return theme.startsWith('custom-') || theme === 'custom'
}

export function isLoadingTheme(theme: string): boolean {
  return theme.startsWith('loading-')
}

export function isPresetTheme(theme: string): theme is PresetThemeId {
  return (PRESET_THEME_IDS as string[]).includes(theme)
}

export function getThemeId(theme: string | undefined | null): string {
  if (!theme || theme === 'custom') return 'fantasy'
  return theme
}

/** 将无效/loading 主题解析为可展示、可游玩的主题 ID */
export function resolveValidTheme(theme: string | undefined | null): GameTheme {
  if (!theme || isLoadingTheme(theme)) return 'fantasy'
  if (isPresetTheme(theme)) return theme
  if (isCustomTheme(theme)) return theme as GameTheme
  return 'fantasy'
}

export function canPlayTheme(
  theme: string,
  hasGameData: boolean,
): boolean {
  if (isLoadingTheme(theme)) return false
  if (isPresetTheme(theme)) return true
  if (isCustomTheme(theme)) return hasGameData
  return false
}
