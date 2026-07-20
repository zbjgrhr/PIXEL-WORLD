export const GROUND_SURFACE_Y = 400
export const PLAYER_GROUND_Y = 352
export const PLAYER_HEIGHT = 48
export const PLAYER_WIDTH = 48

export interface PlatformDef {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface LevelLayoutConfig {
  platforms: Omit<PlatformDef, 'id'>[]
  obstacleCount: number
  minDistance: number
  clusters: number
}

/** 每关地形配置（低/中/高平台 + 障碍密度） */
export const LEVEL_LAYOUTS: LevelLayoutConfig[] = [
  {
    platforms: [
      { x: 220, y: 360, width: 100, height: 40 },
      { x: 420, y: 360, width: 90, height: 40 },
      { x: 580, y: 320, width: 80, height: 40 },
    ],
    obstacleCount: 4,
    minDistance: 120,
    clusters: 0,
  },
  {
    platforms: [
      { x: 180, y: 360, width: 90, height: 40 },
      { x: 320, y: 340, width: 85, height: 40 },
      { x: 480, y: 320, width: 90, height: 40 },
      { x: 620, y: 360, width: 100, height: 40 },
    ],
    obstacleCount: 8,
    minDistance: 90,
    clusters: 0,
  },
  {
    platforms: [
      { x: 150, y: 360, width: 70, height: 40 },
      { x: 280, y: 340, width: 75, height: 40 },
      { x: 400, y: 320, width: 70, height: 40 },
      { x: 520, y: 340, width: 80, height: 40 },
      { x: 650, y: 360, width: 90, height: 40 },
    ],
    obstacleCount: 10,
    minDistance: 70,
    clusters: 2,
  },
  {
    platforms: [
      { x: 120, y: 360, width: 65, height: 40 },
      { x: 220, y: 330, width: 70, height: 40 },
      { x: 340, y: 300, width: 65, height: 40 },
      { x: 460, y: 330, width: 70, height: 40 },
      { x: 580, y: 360, width: 80, height: 40 },
      { x: 700, y: 320, width: 75, height: 40 },
    ],
    obstacleCount: 11,
    minDistance: 60,
    clusters: 1,
  },
  {
    platforms: [
      { x: 100, y: 360, width: 120, height: 40 },
      { x: 350, y: 340, width: 100, height: 40 },
      { x: 550, y: 320, width: 110, height: 40 },
      { x: 720, y: 360, width: 120, height: 40 },
    ],
    obstacleCount: 12,
    minDistance: 55,
    clusters: 2,
  },
]

export interface GeneratedObstacle {
  id: string
  x: number
  y: number
  width: number
  height: number
  type: string
}

function getLayoutForLevel(levelIndex: number): LevelLayoutConfig {
  return LEVEL_LAYOUTS[Math.min(levelIndex, LEVEL_LAYOUTS.length - 1)]
}

function isValidPosition(
  newX: number,
  newY: number,
  width: number,
  height: number,
  existing: Array<{ x: number; y: number; width: number; height: number }>,
  minDistance: number,
) {
  for (const item of existing) {
    const distanceX = Math.abs(newX - item.x)
    const distanceY = Math.abs(newY - item.y)
    if (distanceX < minDistance && distanceY < minDistance) {
      return false
    }
    if (
      newX < item.x + item.width + 8 &&
      newX + width > item.x - 8 &&
      newY < item.y + item.height + 8 &&
      newY + height > item.y - 8
    ) {
      return false
    }
  }
  return true
}

export function buildGroundTiles(
  canvasWidth: number,
  levelIndex: number,
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const layout = getLayoutForLevel(levelIndex)
  const tiles = [
    {
      id: 'ground-strip',
      x: 0,
      y: GROUND_SURFACE_Y,
      width: canvasWidth,
      height: 100,
    },
  ]

  layout.platforms.forEach((p, i) => {
    tiles.push({
      id: `platform-${levelIndex}-${i}`,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    })
  })

  return tiles
}

export function buildLevelObstacles(
  canvasWidth: number,
  levelIndex: number,
  apiObstacles?: Array<{
    id: string
    x: number
    y: number
    width: number
    height: number
    type: string
  }>,
): GeneratedObstacle[] {
  const layout = getLayoutForLevel(levelIndex)
  const obstacleWidth = 48
  const obstacleHeight = 48
  const startX = 150
  const endX = canvasWidth - 150
  const maxAttempts = 50

  const generated: GeneratedObstacle[] = []

  layout.platforms.forEach((p, i) => {
    generated.push({
      id: `platform-${levelIndex}-${i}`,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      type: 'platform',
    })
  })

  const placeObstacle = (x: number, y: number, type: string, suffix: string) => {
    generated.push({
      id: `obstacle-${levelIndex}-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x,
      y,
      width: obstacleWidth,
      height: obstacleHeight,
      type,
    })
  }

  const rockTargets = layout.obstacleCount
  const gridSize = Math.max(60, Math.floor((endX - startX) / rockTargets))

  for (let i = 0; i < rockTargets; i++) {
    let attempts = 0
    let placed = false
    while (!placed && attempts < maxAttempts) {
      const gridStart = startX + i * gridSize
      const gridEnd = Math.min(gridStart + gridSize - obstacleWidth, endX - obstacleWidth)
      const obstacleX = gridStart + Math.random() * Math.max(1, gridEnd - gridStart)
      const obstacleY = GROUND_SURFACE_Y - obstacleHeight

      if (isValidPosition(obstacleX, obstacleY, obstacleWidth, obstacleHeight, generated, layout.minDistance)) {
        placeObstacle(obstacleX, obstacleY, 'rock', `rock-${i}`)
        placed = true
      }
      attempts++
    }
  }

  for (let c = 0; c < layout.clusters; c++) {
    const clusterX = startX + 200 + c * 180 + Math.random() * 80
    for (let j = 0; j < 3; j++) {
      const ox = clusterX + j * 52
      const oy = GROUND_SURFACE_Y - obstacleHeight
      if (ox < endX && isValidPosition(ox, oy, obstacleWidth, obstacleHeight, generated, 40)) {
        placeObstacle(ox, oy, 'rock', `cluster-${c}-${j}`)
      }
    }
  }

  if (apiObstacles?.length) {
    apiObstacles.forEach((obs, i) => {
      const scaleX = canvasWidth / 1000
      const x = Math.min(endX - obstacleWidth, Math.max(startX, obs.x * scaleX))
      const y = obs.y > 200 ? obs.y : GROUND_SURFACE_Y - obstacleHeight
      if (isValidPosition(x, y, obs.width || obstacleWidth, obs.height || obstacleHeight, generated, 50)) {
        generated.push({
          ...obs,
          id: obs.id || `api-${levelIndex}-${i}`,
          x,
          y,
          width: obs.width || obstacleWidth,
          height: obs.height || obstacleHeight,
          type: obs.type || 'rock',
        })
      }
    })
  }

  return generated
}

export function getParallaxOffset(playerX: number): string {
  const offset = Math.min(15, Math.max(-15, playerX * 0.04))
  return `calc(50% + ${-offset}px) center`
}

/** 根据脚下平台/地面计算角色站立高度 */
export function computeStandY(
  x: number,
  width: number,
  obstacleList: Array<{ x: number; y: number; width: number; height: number; type?: string }>,
): number {
  let standY = PLAYER_GROUND_Y
  for (const obs of obstacleList) {
    if (x + width > obs.x && x < obs.x + obs.width) {
      const surfaceY = obs.y - PLAYER_HEIGHT
      if (surfaceY < standY) {
        standY = surfaceY
      }
    }
  }
  return standY
}
