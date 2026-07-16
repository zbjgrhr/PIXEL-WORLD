import { create } from 'zustand'
import { createFallbackGameSpec, normalizeGameSpec } from '@/lib/game-spec'
import { GameTheme, getThemeId, isCustomTheme, resolveValidTheme } from '@/lib/theme-utils'
import { ASSET_TYPES } from '@/types'
import type { AssetType, GameData, LevelData, ObstacleData } from '@/types'

export type { GameTheme } from '@/lib/theme-utils'
export type GameState = 'menu' | 'loading' | 'playing'
export type CharacterType = 'player' | 'enemy' | 'npc'
export type LevelType = 'ground' | 'underground' | 'sky'

interface GroundTile {
  id: string
  x: number
  y: number
  width: number
  height: number
}

type ProcessedImages = Record<string, Partial<Record<AssetType, string>>>

interface GameStore {
  gameState: GameState
  setGameState: (state: GameState) => void
  selectedTheme: GameTheme
  customPrompt: string
  setSelectedTheme: (theme: GameTheme) => void
  setCustomPrompt: (prompt: string) => void
  characterType: CharacterType
  levelType: LevelType
  setCharacterType: (type: CharacterType) => void
  setLevelType: (type: LevelType) => void
  currentAction: string
  setCurrentAction: (action: string) => void
  gameData: GameData
  gameDataByTheme: Record<string, GameData>
  setGameData: (data: GameData, themeId?: string) => void
  getGameDataForTheme: (themeId: string) => GameData
  removeGameDataForTheme: (themeId: string) => void
  currentLevelIndex: number
  totalLevels: number
  levelCount: number
  setCurrentLevelIndex: (index: number) => void
  setTotalLevels: (count: number) => void
  setLevelCount: (count: number) => void
  getCurrentLevel: () => LevelData | null
  nextLevel: () => boolean
  isLastLevel: () => boolean
  processedImages: ProcessedImages
  setProcessedImages: (images: ProcessedImages) => void
  updateProcessedImage: (themeId: string, type: AssetType, url: string) => void
  getProcessedImagesForTheme: (themeId: string) => Partial<Record<AssetType, string>>
  removeProcessedImagesForTheme: (themeId: string) => void
  isLoading: boolean
  loadingProgress: number
  loadingMessage: string
  setLoading: (loading: boolean) => void
  setLoadingProgress: (progress: number) => void
  setLoadingMessage: (message: string) => void
  playerPosition: { x: number; y: number }
  setPlayerPosition: (position: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => void
  groundTiles: GroundTile[]
  groundHeight: number
  setGroundTiles: (tiles: GroundTile[]) => void
  setGroundHeight: (height: number) => void
  obstacles: ObstacleData[]
  setObstacles: (obstacles: ObstacleData[]) => void
  addObstacle: (obstacle: ObstacleData) => void
  removeObstacle: (id: string) => void
  isCollisionEnabled: boolean
  setCollisionEnabled: (enabled: boolean) => void
  saveToLocalStorage: () => void
  loadFromLocalStorage: () => void
  resetGame: () => void
}

function migrateGameData(input: unknown, themeId = 'Pixel World'): GameData {
  const data = input && typeof input === 'object' ? input as GameData : {}
  if (!data.data) return {}
  const levels = Array.isArray(data.data.levels) ? data.data.levels : []
  const fallback = createFallbackGameSpec(themeId, themeId, Math.max(1, levels.length))
  const spec = normalizeGameSpec(data.data.spec || fallback, fallback, Math.max(1, levels.length))
  const migratedLevels: LevelData[] = levels.map((level, index) => ({
    id: level.id || `level-${index + 1}`,
    backgroundUrl: level.backgroundUrl || '',
    groundUrl: level.groundUrl || '',
    obstacleUrl: level.obstacleUrl || '',
    obstacles: Array.isArray(level.obstacles) ? level.obstacles : [],
    enemySpawns: Array.isArray(level.enemySpawns) ? level.enemySpawns : [],
    collectibleSpawns: Array.isArray(level.collectibleSpawns) ? level.collectibleSpawns : [],
    bossSpawn: level.bossSpawn,
  }))
  return {
    ...data,
    data: {
      characterUrl: data.data.characterUrl || '',
      enemyUrl: data.data.enemyUrl || '',
      weaponUrl: data.data.weaponUrl || '',
      projectileUrl: data.data.projectileUrl || '',
      attackEffectUrl: data.data.attackEffectUrl || '',
      collectibleUrl: data.data.collectibleUrl || '',
      bossUrl: data.data.bossUrl || '',
      levels: migratedLevels,
      spec,
    },
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameState: 'menu',
  selectedTheme: 'fantasy',
  customPrompt: '',
  characterType: 'player',
  levelType: 'ground',
  currentAction: 'idle',
  gameData: {},
  gameDataByTheme: {},
  currentLevelIndex: 0,
  totalLevels: 1,
  levelCount: 1,
  processedImages: {},
  isLoading: false,
  loadingProgress: 0,
  loadingMessage: '',
  playerPosition: { x: 50, y: 352 },
  groundTiles: [],
  groundHeight: 350,
  obstacles: [],
  isCollisionEnabled: true,

  setGameState: (gameState) => set({ gameState }),
  setSelectedTheme: (selectedTheme) => {
    const themeData = get().gameDataByTheme[selectedTheme] || {}
    set({
      selectedTheme,
      gameData: themeData,
      totalLevels: themeData.data?.levels?.length || 1,
      currentLevelIndex: 0,
    })
    get().saveToLocalStorage()
  },
  setCustomPrompt: (customPrompt) => set({ customPrompt }),
  setCharacterType: (characterType) => set({ characterType }),
  setLevelType: (levelType) => set({ levelType }),
  setCurrentAction: (currentAction) => set({ currentAction }),
  setGameData: (rawData, themeId) => {
    const state = get()
    const id = getThemeId(themeId || state.selectedTheme)
    const data = migrateGameData(rawData, id)
    const gameDataByTheme = { ...state.gameDataByTheme, [id]: data }
    const processedImages = { ...state.processedImages }
    if (data.data && processedImages[id]) {
      const next = { ...processedImages[id] }
      for (const type of ASSET_TYPES) {
        const globalUrl = type !== 'background' && type !== 'ground' && type !== 'obstacle'
          ? data.data[`${type}Url` as keyof typeof data.data]
          : data.data.levels[0]?.[`${type}Url` as 'backgroundUrl' | 'groundUrl' | 'obstacleUrl']
        if (globalUrl) delete next[type]
      }
      processedImages[id] = next
    }
    set({
      gameDataByTheme,
      processedImages,
      ...(id === state.selectedTheme ? {
        gameData: data,
        totalLevels: data.data?.levels?.length || 1,
        currentLevelIndex: Math.min(state.currentLevelIndex, Math.max(0, (data.data?.levels?.length || 1) - 1)),
      } : {}),
    })
    get().saveToLocalStorage()
  },
  getGameDataForTheme: (themeId) => get().gameDataByTheme[getThemeId(themeId)] || {},
  removeGameDataForTheme: (themeId) => {
    const id = getThemeId(themeId)
    const state = get()
    const { [id]: removed, ...gameDataByTheme } = state.gameDataByTheme
    void removed
    set({
      gameDataByTheme,
      ...(state.selectedTheme === id ? { gameData: {}, totalLevels: 1, currentLevelIndex: 0 } : {}),
    })
    get().saveToLocalStorage()
  },
  setCurrentLevelIndex: (currentLevelIndex) => set({ currentLevelIndex }),
  setTotalLevels: (totalLevels) => set({ totalLevels }),
  setLevelCount: (levelCount) => set({ levelCount }),
  getCurrentLevel: () => get().gameData.data?.levels?.[get().currentLevelIndex] || null,
  nextLevel: () => {
    const next = get().currentLevelIndex + 1
    if (next >= get().totalLevels) return false
    set({ currentLevelIndex: next })
    return true
  },
  isLastLevel: () => get().currentLevelIndex >= get().totalLevels - 1,
  setProcessedImages: (processedImages) => {
    set({ processedImages })
    get().saveToLocalStorage()
  },
  updateProcessedImage: (themeId, type, url) => {
    set((state) => ({
      processedImages: {
        ...state.processedImages,
        [themeId]: { ...state.processedImages[themeId], [type]: url },
      },
    }))
    get().saveToLocalStorage()
  },
  getProcessedImagesForTheme: (themeId) => get().processedImages[themeId] || {},
  removeProcessedImagesForTheme: (themeId) => {
    const id = getThemeId(themeId)
    const { [id]: removed, ...processedImages } = get().processedImages
    void removed
    set({ processedImages })
    get().saveToLocalStorage()
  },
  setLoading: (isLoading) => set({ isLoading }),
  setLoadingProgress: (loadingProgress) => set({ loadingProgress }),
  setLoadingMessage: (loadingMessage) => set({ loadingMessage }),
  setPlayerPosition: (position) => set((state) => ({
    playerPosition: typeof position === 'function' ? position(state.playerPosition) : position,
  })),
  setGroundTiles: (groundTiles) => set({ groundTiles }),
  setGroundHeight: (groundHeight) => set({ groundHeight }),
  setObstacles: (obstacles) => set({ obstacles }),
  addObstacle: (obstacle) => set((state) => ({ obstacles: [...state.obstacles, obstacle] })),
  removeObstacle: (id) => set((state) => ({ obstacles: state.obstacles.filter((item) => item.id !== id) })),
  setCollisionEnabled: (isCollisionEnabled) => set({ isCollisionEnabled }),
  saveToLocalStorage: () => {
    if (typeof window === 'undefined') return
    const state = get()
    localStorage.setItem('pixel-seed-game-data', JSON.stringify({
      gameData: state.gameData,
      gameDataByTheme: state.gameDataByTheme,
      processedImages: state.processedImages,
      selectedTheme: state.selectedTheme,
      customPrompt: state.customPrompt,
    }))
  },
  loadFromLocalStorage: () => {
    if (typeof window === 'undefined') return
    try {
      const saved = localStorage.getItem('pixel-seed-game-data')
      if (!saved) return
      const data = JSON.parse(saved) as {
        gameData?: GameData
        gameDataByTheme?: Record<string, GameData>
        processedImages?: ProcessedImages
        selectedTheme?: string
        customPrompt?: string
      }
      const rawByTheme = { ...(data.gameDataByTheme || {}) }
      const rawTheme = data.selectedTheme || 'fantasy'
      if (data.gameData?.data && !Object.keys(rawByTheme).length) rawByTheme[getThemeId(rawTheme)] = data.gameData
      const gameDataByTheme = Object.fromEntries(
        Object.entries(rawByTheme).map(([id, value]) => [id, migrateGameData(value, id)]),
      )
      let selectedTheme = resolveValidTheme(rawTheme)
      if (isCustomTheme(selectedTheme) && !gameDataByTheme[selectedTheme]?.data) selectedTheme = 'fantasy'
      const gameData = gameDataByTheme[selectedTheme] || migrateGameData(data.gameData, selectedTheme)
      set({
        gameData,
        gameDataByTheme,
        processedImages: data.processedImages || {},
        selectedTheme,
        customPrompt: data.customPrompt || '',
        totalLevels: gameData.data?.levels?.length || 1,
      })
    } catch (error) {
      console.error('Failed to load saved game:', error)
    }
  },
  resetGame: () => set((state) => ({
    gameState: 'menu',
    currentAction: 'idle',
    currentLevelIndex: 0,
    isLoading: false,
    loadingProgress: 0,
    loadingMessage: '',
    playerPosition: { x: 50, y: 352 },
    groundTiles: [],
    obstacles: [],
    selectedTheme: state.selectedTheme,
    gameData: state.gameData,
  })),
}))
