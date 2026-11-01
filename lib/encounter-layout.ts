import type { LevelData, ObstacleData } from '@/types'

/** Runtime layout rules, not an edit of the approved story or actor statistics. */
export function ensureEncounterClearance(source: LevelData, fallbackEnemyCount = 0): LevelData {
  if (source.layoutVersion === 2 && (source.enemySpawns?.length || !fallbackEnemyCount)) return source
  const obstacles = (source.obstacles || []).map(obstacle => ({ ...obstacle,
    width: Math.max(42, Math.min(80, obstacle.width || 48)), height: Math.max(42, Math.min(80, obstacle.height || 48)),
  }))
  const tutorial = obstacles.find(obstacle => ['normalObstacle','bounceObstacle'].includes(obstacle.type) && obstacle.x >= 150 && obstacle.x <= 220)
  const combatStartX = tutorial ? tutorial.x + tutorial.width + 70 : 200
  const sourceSpawns = source.enemySpawns?.length ? source.enemySpawns : Array.from({ length: fallbackEnemyCount }, (_, index) => ({ id: `enemy-${index}`, x:280+index*130,y:352,kind:'groundEnemy' }))
  const enemySpawns = sourceSpawns.map(spawn => {
    const x = Math.max(combatStartX, spawn.x)
    return { ...spawn, x, patrolMin: Math.max(combatStartX, x - 100), patrolMax: x + 100 }
  })
  // Include the whole patrol region and the actor's width, not just spawn X.
  // All later obstacles start beyond this clear combat lane.
  const combatEnd = Math.max(combatStartX + 100,
    ...enemySpawns.map(spawn => spawn.patrolMax + 52),
    source.bossSpawn ? source.bossSpawn.x + 180 + 100 : 0,
  )
  let nextObstacleX = combatEnd + 70
  const arranged: ObstacleData[] = obstacles.map(obstacle => {
    if (obstacle === tutorial) return obstacle
    const moved = { ...obstacle, x: Math.max(nextObstacleX, obstacle.type === 'deathObstacle' ? 810 : 0) }
    nextObstacleX = moved.x + moved.width + 92
    return moved
  })
  const lastEdge = Math.max(0, ...arranged.map(obstacle => obstacle.x + obstacle.width))
  return { ...source, obstacles: arranged, enemySpawns, combatStartX,
    worldWidth: Math.max(1120, source.worldWidth || 0, lastEdge + 230), layoutVersion: 2,
  }
}
