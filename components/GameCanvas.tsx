'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, Card, Empty, Progress, Space, Tag, Typography } from 'antd'
import { ArrowLeft, ArrowRight, Crosshair, Pause, Play, RotateCcw, Swords } from 'lucide-react'
import { useGameStore } from '@/lib/store'
import { getThemeId } from '@/lib/theme-utils'
import type { AssetType, GameCanvasProps, ObstacleData } from '@/types'

const { Title, Text } = Typography
const STAGE_HEIGHT = 560
const GROUND_TOP = 438
const PLAYER_WIDTH = 54
const PLAYER_HEIGHT = 64
const ENEMY_WIDTH = 52
const ENEMY_HEIGHT = 54

type GameMode = 'playing' | 'paused' | 'transition' | 'dead' | 'victory'

interface PlayerRuntime {
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  health: number
  maxHealth: number
  facing: 1 | -1
  onGround: boolean
  invulnerableUntil: number
  meleeReadyAt: number
  rangedReadyAt: number
}

interface EnemyRuntime {
  id: string
  x: number
  y: number
  width: number
  height: number
  health: number
  maxHealth: number
  damage: number
  speed: number
  direction: 1 | -1
  patrolMin: number
  patrolMax: number
  lastShotAt: number
  ranged: boolean
  isBoss: boolean
}

interface ProjectileRuntime {
  id: string
  x: number
  y: number
  width: number
  height: number
  vx: number
  damage: number
  hostile: boolean
}

interface CollectibleRuntime {
  id: string
  x: number
  y: number
  collected: boolean
}

interface EffectRuntime {
  id: string
  x: number
  y: number
  facing: 1 | -1
  expiresAt: number
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function fallbackSprite(label: string, color: string, size = 48) {
  return (
    <div style={{
      width: size,
      height: size,
      display: 'grid',
      placeItems: 'center',
      background: color,
      border: '3px solid rgba(255,255,255,.8)',
      borderRadius: 8,
      color: '#fff',
      fontWeight: 900,
      fontSize: 11,
      imageRendering: 'pixelated',
      boxShadow: '0 4px 0 rgba(0,0,0,.35)',
    }}>{label}</div>
  )
}

const GameCanvas: React.FC<GameCanvasProps> = ({ onBackToMenu }) => {
  const {
    gameData,
    selectedTheme,
    currentLevelIndex,
    totalLevels,
    nextLevel,
    setCurrentLevelIndex,
    getProcessedImagesForTheme,
    resetGame,
    setGameState,
  } = useGameStore()
  const data = gameData.data
  const level = data?.levels[currentLevelIndex]
  const spec = data?.spec
  const stageRef = useRef<HTMLDivElement>(null)
  const keysRef = useRef(new Set<string>())
  const playerRef = useRef<PlayerRuntime | null>(null)
  const enemiesRef = useRef<EnemyRuntime[]>([])
  const projectilesRef = useRef<ProjectileRuntime[]>([])
  const collectiblesRef = useRef<CollectibleRuntime[]>([])
  const effectsRef = useRef<EffectRuntime[]>([])
  const obstaclesRef = useRef<ObstacleData[]>([])
  const scoreRef = useRef(0)
  const powerRef = useRef(1)
  const modeRef = useRef<GameMode>('playing')
  const transitionRef = useRef(false)
  const animationRef = useRef<number | null>(null)
  const [mode, setModeState] = useState<GameMode>('playing')
  const [renderTick, setRenderTick] = useState(0)
  const [banner, setBanner] = useState('')
  const [viewportWidth, setViewportWidth] = useState(900)

  const setMode = useCallback((next: GameMode) => {
    modeRef.current = next
    setModeState(next)
  }, [])

  const processed = getProcessedImagesForTheme(getThemeId(selectedTheme))
  const assets = useMemo(() => {
    const globalUrl = (type: Exclude<AssetType, 'background' | 'ground' | 'obstacle'>) =>
      processed[type] || data?.[`${type}Url`] || ''
    return {
      character: globalUrl('character'),
      enemy: globalUrl('enemy'),
      weapon: globalUrl('weapon'),
      projectile: globalUrl('projectile'),
      attackEffect: globalUrl('attackEffect'),
      collectible: globalUrl('collectible'),
      boss: globalUrl('boss'),
      background: processed.background || level?.backgroundUrl || '',
      ground: processed.ground || level?.groundUrl || '',
      obstacle: processed.obstacle || level?.obstacleUrl || '',
    }
  }, [processed, data, level])

  const worldWidth = Math.max(1120, viewportWidth)

  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) setViewportWidth(stageRef.current.clientWidth)
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  const initializeLevel = useCallback(() => {
    if (!data || !level || !spec) return
    const previousHealth = playerRef.current?.health ?? spec.hero.maxHealth
    const health = currentLevelIndex > 0
      ? Math.min(spec.hero.maxHealth, previousHealth + 15)
      : previousHealth
    playerRef.current = {
      x: 60,
      y: GROUND_TOP - PLAYER_HEIGHT,
      vx: 0,
      vy: 0,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      health,
      maxHealth: spec.hero.maxHealth,
      facing: 1,
      onGround: true,
      invulnerableUntil: 0,
      meleeReadyAt: 0,
      rangedReadyAt: 0,
    }
    obstaclesRef.current = (level.obstacles || []).map((obstacle, index) => ({
      ...obstacle,
      id: obstacle.id || `obstacle-${index}`,
      width: Math.max(42, Math.min(80, obstacle.width || 48)),
      height: Math.max(42, Math.min(80, obstacle.height || 48)),
      x: Math.max(150, Math.min(worldWidth - 180, obstacle.x || 220 + index * 100)),
      y: GROUND_TOP - Math.max(42, Math.min(80, obstacle.height || 48)),
    }))
    const enemySpec = spec.enemies[0]
    const spawns = level.enemySpawns?.length
      ? level.enemySpawns
      : Array.from({ length: spec.levels[currentLevelIndex]?.enemyCount || 3 }, (_, index) => ({
          id: `enemy-${index}`,
          x: 280 + index * 130,
          y: GROUND_TOP - ENEMY_HEIGHT,
          kind: 'enemy',
        }))
    enemiesRef.current = spawns.map((spawn, index): EnemyRuntime => ({
      id: spawn.id,
      x: Math.max(220, Math.min(worldWidth - 180, spawn.x)),
      y: GROUND_TOP - ENEMY_HEIGHT,
      width: ENEMY_WIDTH,
      height: ENEMY_HEIGHT,
      health: enemySpec.health + currentLevelIndex * 8,
      maxHealth: enemySpec.health + currentLevelIndex * 8,
      damage: enemySpec.damage + currentLevelIndex * 2,
      speed: enemySpec.speed + currentLevelIndex * 0.08,
      direction: index % 2 ? -1 : 1,
      patrolMin: Math.max(150, spawn.x - 100),
      patrolMax: Math.min(worldWidth - 100, spawn.x + 100),
      lastShotAt: 0,
      ranged: enemySpec.behavior === 'ranged' || index % 3 === 2,
      isBoss: false,
    }))
    if (level.bossSpawn) {
      enemiesRef.current.push({
        id: level.bossSpawn.id,
        x: Math.min(worldWidth - 180, Math.max(600, level.bossSpawn.x)),
        y: GROUND_TOP - 94,
        width: 94,
        height: 94,
        health: spec.boss.health,
        maxHealth: spec.boss.health,
        damage: spec.boss.damage,
        speed: spec.boss.speed,
        direction: -1,
        patrolMin: Math.max(520, level.bossSpawn.x - 180),
        patrolMax: Math.min(worldWidth - 80, level.bossSpawn.x + 180),
        lastShotAt: 0,
        ranged: true,
        isBoss: true,
      })
    }
    collectiblesRef.current = (level.collectibleSpawns || []).map((spawn) => ({
      id: spawn.id,
      x: Math.max(150, Math.min(worldWidth - 120, spawn.x)),
      y: Math.min(GROUND_TOP - 42, spawn.y || GROUND_TOP - 100),
      collected: false,
    }))
    projectilesRef.current = []
    effectsRef.current = []
    keysRef.current.clear()
    transitionRef.current = false
    setBanner(`LEVEL ${currentLevelIndex + 1} — ${spec.levels[currentLevelIndex]?.name || ''}`)
    setMode('playing')
    const timer = window.setTimeout(() => setBanner(''), 1500)
    setRenderTick((value) => value + 1)
    return () => window.clearTimeout(timer)
  }, [currentLevelIndex, data, level, setMode, spec, worldWidth])

  useEffect(() => initializeLevel(), [initializeLevel])

  const awardEnemy = useCallback((enemy: EnemyRuntime) => {
    scoreRef.current += enemy.isBoss ? 1000 : 150
  }, [])

  const damageEnemy = useCallback((enemy: EnemyRuntime, damage: number) => {
    if (enemy.health <= 0) return
    enemy.health -= Math.round(damage * powerRef.current)
    if (enemy.health <= 0) awardEnemy(enemy)
  }, [awardEnemy])

  const meleeAttack = useCallback(() => {
    const player = playerRef.current
    const currentSpec = gameData.data?.spec
    if (!player || !currentSpec || modeRef.current !== 'playing') return
    const now = performance.now()
    if (now < player.meleeReadyAt) return
    player.meleeReadyAt = now + currentSpec.weapon.cooldownMs
    const hitbox = {
      x: player.facing === 1 ? player.x + player.width - 4 : player.x - 88,
      y: player.y - 4,
      width: 92,
      height: player.height + 8,
    }
    enemiesRef.current.forEach((enemy) => {
      if (enemy.health > 0 && intersects(hitbox, enemy)) damageEnemy(enemy, currentSpec.weapon.meleeDamage)
    })
    effectsRef.current.push({
      id: `slash-${Date.now()}`,
      x: hitbox.x,
      y: hitbox.y,
      facing: player.facing,
      expiresAt: now + 180,
    })
  }, [damageEnemy, gameData.data?.spec])

  const rangedAttack = useCallback(() => {
    const player = playerRef.current
    const currentSpec = gameData.data?.spec
    if (!player || !currentSpec || modeRef.current !== 'playing') return
    const now = performance.now()
    if (now < player.rangedReadyAt) return
    player.rangedReadyAt = now + Math.max(240, currentSpec.weapon.cooldownMs * 1.2)
    projectilesRef.current.push({
      id: `player-shot-${Date.now()}`,
      x: player.facing === 1 ? player.x + player.width : player.x - 24,
      y: player.y + 24,
      width: 24,
      height: 16,
      vx: currentSpec.weapon.projectileSpeed * player.facing,
      damage: currentSpec.weapon.rangedDamage,
      hostile: false,
    })
  }, [gameData.data?.spec])

  const damagePlayer = useCallback((damage: number) => {
    const player = playerRef.current
    if (!player) return
    const now = performance.now()
    if (now < player.invulnerableUntil) return
    player.health = Math.max(0, player.health - damage)
    player.invulnerableUntil = now + 850
    if (player.health <= 0) setMode('dead')
  }, [setMode])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (['arrowleft', 'arrowright', ' ', 'j', 'k', 'escape'].includes(key)) event.preventDefault()
      if (key === 'escape') {
        if (modeRef.current === 'playing') setMode('paused')
        else if (modeRef.current === 'paused') setMode('playing')
        return
      }
      if (event.repeat) return
      keysRef.current.add(key)
      if (key === 'j') meleeAttack()
      if (key === 'k' || key === 'f') rangedAttack()
    }
    const keyUp = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase())
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
    }
  }, [meleeAttack, rangedAttack, setMode])

  useEffect(() => {
    if (!data || !level || !spec) return
    let last = performance.now()

    const loop = (now: number) => {
      const delta = Math.min(2, (now - last) / 16.67)
      last = now
      const player = playerRef.current
      if (modeRef.current === 'playing' && player) {
        const moveLeft = keysRef.current.has('a') || keysRef.current.has('arrowleft')
        const moveRight = keysRef.current.has('d') || keysRef.current.has('arrowright')
        const jump = keysRef.current.has(' ') || keysRef.current.has('w') || keysRef.current.has('arrowup')
        player.vx = (moveRight ? spec.hero.moveSpeed : 0) - (moveLeft ? spec.hero.moveSpeed : 0)
        if (player.vx) player.facing = player.vx > 0 ? 1 : -1
        if (jump && player.onGround) {
          player.vy = -spec.hero.jumpPower
          player.onGround = false
        }

        let nextX = Math.max(0, Math.min(worldWidth - player.width, player.x + player.vx * delta))
        const horizontalBox = { ...player, x: nextX }
        if (obstaclesRef.current.some((obstacle) => intersects(horizontalBox, obstacle))) nextX = player.x
        player.x = nextX

        player.vy += 0.82 * delta
        let nextY = player.y + player.vy * delta
        player.onGround = false
        if (nextY + player.height >= GROUND_TOP) {
          nextY = GROUND_TOP - player.height
          player.vy = 0
          player.onGround = true
        } else if (player.vy >= 0) {
          const previousBottom = player.y + player.height
          for (const obstacle of obstaclesRef.current) {
            const overlapsX = player.x + player.width > obstacle.x && player.x < obstacle.x + obstacle.width
            if (overlapsX && previousBottom <= obstacle.y + 7 && nextY + player.height >= obstacle.y) {
              nextY = obstacle.y - player.height
              player.vy = 0
              player.onGround = true
              break
            }
          }
        }
        player.y = nextY

        enemiesRef.current.forEach((enemy) => {
          if (enemy.health <= 0) return
          const distance = player.x - enemy.x
          if (Math.abs(distance) < (enemy.isBoss ? 480 : 300)) enemy.direction = distance >= 0 ? 1 : -1
          else if (enemy.x <= enemy.patrolMin) enemy.direction = 1
          else if (enemy.x >= enemy.patrolMax) enemy.direction = -1
          enemy.x = Math.max(120, Math.min(worldWidth - enemy.width - 45, enemy.x + enemy.speed * enemy.direction * delta))
          enemy.y = GROUND_TOP - enemy.height

          if (intersects(player, enemy)) damagePlayer(enemy.damage)
          const shotDelay = enemy.isBoss ? 1050 : 2200
          if (enemy.ranged && Math.abs(distance) < 520 && now - enemy.lastShotAt > shotDelay) {
            enemy.lastShotAt = now
            projectilesRef.current.push({
              id: `enemy-shot-${enemy.id}-${Date.now()}`,
              x: enemy.x + enemy.width / 2,
              y: enemy.y + enemy.height * 0.4,
              width: enemy.isBoss ? 28 : 20,
              height: enemy.isBoss ? 22 : 16,
              vx: (distance >= 0 ? 1 : -1) * (enemy.isBoss ? 7 : 5),
              damage: enemy.isBoss ? Math.round(enemy.damage * 0.75) : Math.round(enemy.damage * 0.6),
              hostile: true,
            })
          }
        })

        projectilesRef.current.forEach((shot) => {
          shot.x += shot.vx * delta
          if (shot.hostile) {
            if (intersects(shot, player)) {
              damagePlayer(shot.damage)
              shot.x = -9999
            }
          } else {
            const target = enemiesRef.current.find((enemy) => enemy.health > 0 && intersects(shot, enemy))
            if (target) {
              damageEnemy(target, shot.damage)
              shot.x = -9999
            }
          }
          if (obstaclesRef.current.some((obstacle) => intersects(shot, obstacle))) shot.x = -9999
        })
        projectilesRef.current = projectilesRef.current.filter((shot) => shot.x > -100 && shot.x < worldWidth + 100)
        enemiesRef.current = enemiesRef.current.filter((enemy) => enemy.health > 0)
        effectsRef.current = effectsRef.current.filter((effect) => effect.expiresAt > now)

        collectiblesRef.current.forEach((item) => {
          if (item.collected) return
          const box = { x: item.x, y: item.y, width: 34, height: 34 }
          if (intersects(player, box)) {
            item.collected = true
            const collectible = spec.collectible
            scoreRef.current += collectible.value
            if (collectible.effect === 'heal') player.health = Math.min(player.maxHealth, player.health + collectible.value)
            if (collectible.effect === 'power') powerRef.current = Math.min(2.5, powerRef.current + 0.15)
          }
        })

        if (player.x >= worldWidth - 95 && enemiesRef.current.length === 0 && !transitionRef.current) {
          transitionRef.current = true
          if (currentLevelIndex >= totalLevels - 1) {
            setMode('victory')
          } else {
            setMode('transition')
            setBanner(`LEVEL ${currentLevelIndex + 1} CLEAR`)
            window.setTimeout(() => {
              nextLevel()
              transitionRef.current = false
            }, 1100)
          }
        }
      }
      setRenderTick((value) => (value + 1) % 100000)
      animationRef.current = requestAnimationFrame(loop)
    }
    animationRef.current = requestAnimationFrame(loop)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [currentLevelIndex, damageEnemy, damagePlayer, data, level, nextLevel, setMode, spec, totalLevels, worldWidth])

  const restartCampaign = () => {
    scoreRef.current = 0
    powerRef.current = 1
    playerRef.current = null
    setCurrentLevelIndex(0)
    setMode('playing')
    transitionRef.current = false
    window.setTimeout(() => initializeLevel(), 0)
  }

  const backToMenu = () => {
    resetGame()
    setGameState('menu')
    onBackToMenu?.()
  }

  const pressMovement = (key: string, pressed: boolean) => {
    if (pressed) keysRef.current.add(key)
    else keysRef.current.delete(key)
  }

  if (!data || !level || !spec) {
    return (
      <Card style={{ height: '100%' }}>
        <Empty description="No playable game data">
          <Button onClick={backToMenu}>Back to menu</Button>
        </Empty>
      </Card>
    )
  }

  void renderTick
  const player = playerRef.current
  const cameraX = player ? Math.max(0, Math.min(worldWidth - viewportWidth, player.x - viewportWidth * 0.42)) : 0
  const boss = enemiesRef.current.find((enemy) => enemy.isBoss)
  const remaining = enemiesRef.current.length
  const levelCleared = remaining === 0

  const renderImage = (url: string, alt: string, style: CSSProperties, fallback: ReactNode) =>
    url ? <img src={url} alt={alt} draggable={false} style={{ ...style, imageRendering: 'pixelated', userSelect: 'none', pointerEvents: 'none' }} /> : fallback

  return (
    <Card styles={{ body: { padding: 0 } }} style={{ overflow: 'hidden', background: '#080d1d' }}>
      <div style={{ padding: '12px 16px', background: '#10182d', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Space wrap>
          <Title level={4} style={{ color: '#fff', margin: 0 }}>{spec.title}</Title>
          <Tag color="blue">Level {currentLevelIndex + 1}/{totalLevels}</Tag>
          <Tag color={remaining ? 'red' : 'green'}>{remaining ? `${remaining} enemies` : 'Exit unlocked'}</Tag>
          <Tag color="gold">Score {scoreRef.current}</Tag>
          {powerRef.current > 1 && <Tag color="purple">Power ×{powerRef.current.toFixed(2)}</Tag>}
        </Space>
        <Space>
          <Button
            size="small"
            icon={mode === 'paused' ? <Play size={14} /> : <Pause size={14} />}
            onClick={() => setMode(mode === 'paused' ? 'playing' : 'paused')}
          />
          <Button size="small" onClick={backToMenu}>Menu</Button>
        </Space>
      </div>

      <div style={{ padding: '8px 16px', background: '#0b1122', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <Text style={{ color: '#fff', fontSize: 12 }}>{spec.hero.name}</Text>
          <Progress
            percent={player ? Math.round(player.health / player.maxHealth * 100) : 100}
            showInfo={false}
            strokeColor="#39e58c"
            trailColor="#2a3045"
            size="small"
          />
        </div>
        <div>
          <Text style={{ color: boss ? '#ff9c9c' : '#8892ad', fontSize: 12 }}>{boss ? spec.boss.name : 'Boss appears in the final arena'}</Text>
          <Progress
            percent={boss ? Math.max(0, Math.round(boss.health / boss.maxHealth * 100)) : 0}
            showInfo={false}
            strokeColor="#ff4d4f"
            trailColor="#2a3045"
            size="small"
          />
        </div>
      </div>

      <div ref={stageRef} style={{ position: 'relative', height: STAGE_HEIGHT, overflow: 'hidden', background: '#101527', touchAction: 'none' }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: assets.background ? `linear-gradient(rgba(4,8,20,.08), rgba(4,8,20,.3)), url("${assets.background}")` : 'linear-gradient(#183455, #0b142b)',
          backgroundSize: 'cover',
          backgroundPosition: `${50 - cameraX / worldWidth * 14}% center`,
          imageRendering: 'pixelated',
        }} />

        <div style={{ position: 'absolute', width: worldWidth, height: STAGE_HEIGHT, transform: `translateX(${-cameraX}px)`, willChange: 'transform' }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: GROUND_TOP,
            width: worldWidth,
            height: STAGE_HEIGHT - GROUND_TOP,
            backgroundImage: assets.ground ? `url("${assets.ground}")` : 'linear-gradient(#5f6f39, #3c3928)',
            backgroundSize: '110px 110px',
            imageRendering: 'pixelated',
            borderTop: '4px solid rgba(220,255,145,.75)',
          }} />

          {obstaclesRef.current.map((obstacle) => (
            <div key={obstacle.id} style={{ position: 'absolute', left: obstacle.x, top: obstacle.y, width: obstacle.width, height: obstacle.height }}>
              {renderImage(assets.obstacle, 'Obstacle', { width: '100%', height: '100%', objectFit: 'contain' }, fallbackSprite('BLOCK', '#6d4c41', obstacle.width))}
            </div>
          ))}

          {collectiblesRef.current.filter((item) => !item.collected).map((item) => (
            <div key={item.id} style={{ position: 'absolute', left: item.x, top: item.y, width: 36, height: 36, filter: 'drop-shadow(0 0 8px #77f7ff)', animation: 'pulse 1s infinite alternate' }}>
              {renderImage(assets.collectible, spec.collectible.name, { width: '100%', height: '100%', objectFit: 'contain' }, fallbackSprite('SEED', '#08a88a', 34))}
            </div>
          ))}

          {enemiesRef.current.map((enemy) => (
            <div key={enemy.id} style={{ position: 'absolute', left: enemy.x, top: enemy.y, width: enemy.width, height: enemy.height }}>
              <div style={{ position: 'absolute', left: 0, top: -9, width: '100%', height: 5, background: '#2b2030', borderRadius: 3 }}>
                <div style={{ width: `${Math.max(0, enemy.health / enemy.maxHealth * 100)}%`, height: '100%', background: enemy.isBoss ? '#ff375f' : '#ff7547', borderRadius: 3 }} />
              </div>
              {renderImage(
                enemy.isBoss ? assets.boss : assets.enemy,
                enemy.isBoss ? spec.boss.name : spec.enemies[0].name,
                { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${enemy.direction === 1 ? -1 : 1})`, filter: 'drop-shadow(0 5px 3px rgba(0,0,0,.55))' },
                fallbackSprite(enemy.isBoss ? 'BOSS' : 'ENEMY', enemy.isBoss ? '#8e2145' : '#9b3a32', enemy.width),
              )}
            </div>
          ))}

          {projectilesRef.current.map((shot) => (
            <div key={shot.id} style={{ position: 'absolute', left: shot.x, top: shot.y, width: shot.width, height: shot.height, filter: shot.hostile ? 'hue-rotate(150deg) drop-shadow(0 0 6px #ff3b64)' : 'drop-shadow(0 0 6px #6ee7ff)' }}>
              {renderImage(assets.projectile, 'Projectile', { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${shot.vx < 0 ? -1 : 1})` }, fallbackSprite('•', shot.hostile ? '#ff365e' : '#1fb7f2', shot.width))}
            </div>
          ))}

          {effectsRef.current.map((effect) => (
            <div key={effect.id} style={{ position: 'absolute', left: effect.x, top: effect.y, width: 92, height: 72 }}>
              {renderImage(assets.attackEffect, 'Slash', { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${effect.facing})`, filter: 'drop-shadow(0 0 10px #9fffff)' }, <div style={{ fontSize: 54, color: '#8ff', transform: `scaleX(${effect.facing})` }}>◜</div>)}
            </div>
          ))}

          {player && (
            <div style={{
              position: 'absolute',
              left: player.x,
              top: player.y,
              width: player.width,
              height: player.height,
              opacity: performance.now() < player.invulnerableUntil && Math.floor(performance.now() / 80) % 2 ? 0.35 : 1,
              filter: 'drop-shadow(0 5px 3px rgba(0,0,0,.6))',
            }}>
              {renderImage(assets.character, spec.hero.name, { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${player.facing})` }, fallbackSprite('HERO', '#2664c9', 54))}
              <div style={{ position: 'absolute', left: player.facing === 1 ? 34 : -14, top: 25, width: 34, height: 20 }}>
                {renderImage(assets.weapon, spec.weapon.name, { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${player.facing}) rotate(${player.facing === 1 ? -10 : 10}deg)` }, null)}
              </div>
            </div>
          )}

          <div style={{ position: 'absolute', left: worldWidth - 82, top: GROUND_TOP - 92, width: 58, height: 92, display: 'grid', placeItems: 'center' }}>
            <div style={{
              width: 48,
              height: 82,
              border: `5px solid ${levelCleared ? '#5df5b2' : '#667085'}`,
              borderRadius: '24px 24px 3px 3px',
              background: levelCleared ? 'radial-gradient(#9dffe0, #0b6c7a 65%, #051c35)' : '#222938',
              boxShadow: levelCleared ? '0 0 24px #52ffc8' : 'none',
            }} />
            <Text style={{ position: 'absolute', bottom: -24, color: '#fff', fontSize: 11 }}>{levelCleared ? 'EXIT' : 'LOCKED'}</Text>
          </div>
        </div>

        {banner && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><div style={{ padding: '14px 28px', color: '#fff', background: 'rgba(5,10,25,.82)', border: '2px solid #61dafb', fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>{banner}</div></div>}

        {(mode === 'paused' || mode === 'dead' || mode === 'victory' || mode === 'transition') && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(3,6,16,.68)', zIndex: 20 }}>
            <div style={{ textAlign: 'center', color: '#fff', padding: 28 }}>
              <Title style={{ color: '#fff' }}>{mode === 'paused' ? 'Paused' : mode === 'dead' ? 'Game Over' : mode === 'victory' ? 'Victory!' : 'Level Clear'}</Title>
              {mode === 'victory' && <Text style={{ color: '#ffe985', display: 'block', marginBottom: 18 }}>Score: {scoreRef.current} · Boss defeated · All levels cleared</Text>}
              {mode === 'paused' && <Button type="primary" icon={<Play size={15} />} onClick={() => setMode('playing')}>Resume</Button>}
              {(mode === 'dead' || mode === 'victory') && <Button type="primary" icon={<RotateCcw size={15} />} onClick={restartCampaign}>Restart campaign</Button>}
            </div>
          </div>
        )}

        <div style={{ position: 'absolute', left: 16, bottom: 14, display: 'flex', gap: 8, zIndex: 12 }}>
          <Button
            shape="circle"
            size="large"
            icon={<ArrowLeft />}
            onPointerDown={() => pressMovement('a', true)}
            onPointerUp={() => pressMovement('a', false)}
            onPointerLeave={() => pressMovement('a', false)}
          />
          <Button
            shape="circle"
            size="large"
            icon={<ArrowRight />}
            onPointerDown={() => pressMovement('d', true)}
            onPointerUp={() => pressMovement('d', false)}
            onPointerLeave={() => pressMovement('d', false)}
          />
          <Button
            size="large"
            onPointerDown={() => pressMovement(' ', true)}
            onPointerUp={() => pressMovement(' ', false)}
            onPointerLeave={() => pressMovement(' ', false)}
          >Jump</Button>
        </div>
        <div style={{ position: 'absolute', right: 16, bottom: 14, display: 'flex', gap: 8, zIndex: 12 }}>
          <Button danger size="large" icon={<Swords size={17} />} onPointerDown={meleeAttack}>Slash</Button>
          <Button type="primary" size="large" icon={<Crosshair size={17} />} onPointerDown={rangedAttack}>Shoot</Button>
        </div>
      </div>

      <div style={{ padding: '10px 16px', background: '#0b1122', color: '#aeb8d0', fontSize: 12 }}>
        <Space wrap split={<span>•</span>}>
          <span>A/D or ←/→ move</span>
          <span>W/Space jump</span>
          <span>J melee</span>
          <span>K/F ranged</span>
          <span>ESC pause</span>
          <span>Defeat every enemy to unlock the exit</span>
        </Space>
      </div>
    </Card>
  )
}

export default GameCanvas
