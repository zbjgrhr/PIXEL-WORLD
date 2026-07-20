'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Button, Card, Drawer, Empty, Progress, Segmented, Slider, Space, Switch, Tag, Typography, message } from 'antd'
import { ArrowLeft, ArrowRight, Crosshair, Pause, Play, RotateCcw, Settings, Swords } from 'lucide-react'
import { useGameStore } from '@/lib/store'
import { getThemeId } from '@/lib/theme-utils'
import {
  DEFAULT_GAME_SETTINGS,
  getGraphicsFilter,
  loadGameSettings,
  saveGameSettings,
} from '@/lib/game-settings'
import { loadImageApiPrefs } from '@/lib/image-api-prefs'
import { normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { DisplaySize, GameSettings } from '@/lib/game-settings'
import type { AnimationPose, AssetCategory, AssetDefinition, AssetType, GameCanvasProps, ObstacleData } from '@/types'

const { Title, Text } = Typography
const PLAYER_WIDTH = 54
const PLAYER_HEIGHT = 64
const ENEMY_WIDTH = 52
const ENEMY_HEIGHT = 54
const EXIT_WIDTH = 64
const EXIT_HEIGHT = 96
const EXIT_RIGHT_MARGIN = 42
const EXIT_SAFE_ZONE = 230
const ATTACK_POSE_MS = 320
const HIT_POSE_MS = 260
const DEATH_POSE_MS = 720

const DISPLAY_PRESETS: Record<DisplaySize, { label: string; maxWidth?: number; stageHeight: number }> = {
  compact: { label: '紧凑 960px', maxWidth: 960, stageHeight: 460 },
  standard: { label: '标准 1280px', maxWidth: 1280, stageHeight: 560 },
  expanded: { label: '宽屏铺满', stageHeight: 650 },
}

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
  action: AnimationPose
  actionStartedAt: number
  actionUntil: number
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
  assetId: string
  mobility: 'ground' | 'air' | 'water' | 'boss'
  baseY: number
  phase: number
  vy: number
  onGround: boolean
  nextDecisionAt: number
  idleUntil: number
  removeAt: number
  action: AnimationPose
  actionStartedAt: number
  actionUntil: number
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
  kind: 'melee' | 'ranged' | 'impact' | 'enemy'
  hostile?: boolean
}

interface RuntimeObstacle extends ObstacleData {
  assetId?: string
  baseY?: number
  phase?: number
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

function plannedSprite(
  asset: AssetDefinition | undefined,
  url: string,
  state: AnimationPose,
  timeMs: number,
  stateStartedAt: number,
  stateUntil: number,
  alt: string,
  style: CSSProperties,
  fallback: ReactNode,
) {
  if (!url) return fallback
  if (asset?.kind !== 'spriteSheet' || !asset.animation) {
    return <img src={url} alt={alt} draggable={false} style={{ ...style, imageRendering: 'pixelated', userSelect: 'none', pointerEvents: 'none' }} />
  }
  const animation = normalizeAnimationSpec(asset.animation)
  const row = Math.max(0, Math.min(animation.rows - 1, animation.states[state]))
  const elapsed = Math.max(0, timeMs - stateStartedAt)
  const oneShot = state === 'attack' || state === 'hit' || state === 'death'
  const duration = Math.max(1, stateUntil - stateStartedAt)
  const frame = oneShot
    ? Math.min(animation.columns - 1, Math.floor(elapsed / duration * animation.columns))
    : Math.floor(elapsed / (1000 / animation.fps)) % animation.columns
  const x = animation.columns > 1 ? frame / (animation.columns - 1) * 100 : 0
  const y = animation.rows > 1 ? row / (animation.rows - 1) * 100 : 0
  return <div role="img" aria-label={alt} style={{
    ...style,
    backgroundImage: `url("${url}")`,
    backgroundSize: `${animation.columns * 100}% ${animation.rows * 100}%`,
    backgroundPosition: `${x}% ${y}%`,
    backgroundRepeat: 'no-repeat',
    imageRendering: 'pixelated',
    userSelect: 'none',
    pointerEvents: 'none',
  }} />
}

function setActorAction(
  actor: { action: AnimationPose; actionStartedAt: number; actionUntil: number },
  action: AnimationPose,
  now: number,
  duration = 0,
) {
  if (actor.action !== action) {
    actor.action = action
    actor.actionStartedAt = now
  }
  actor.actionUntil = duration > 0 ? now + duration : 0
}

const GameCanvas: React.FC<GameCanvasProps> = ({ onBackToMenu }) => {
  const {
    gameData,
    selectedTheme,
    currentLevelIndex,
    totalLevels,
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
  const obstaclesRef = useRef<RuntimeObstacle[]>([])
  const scoreRef = useRef(0)
  const powerRef = useRef(1)
  const modeRef = useRef<GameMode>('playing')
  const transitionRef = useRef(false)
  const transitionTimerRef = useRef<number | null>(null)
  const animationRef = useRef<number | null>(null)
  const resumeAfterSettingsRef = useRef(false)
  const settingsRef = useRef<GameSettings>(DEFAULT_GAME_SETTINGS)
  const musicContextRef = useRef<AudioContext | null>(null)
  const musicGainRef = useRef<GainNode | null>(null)
  const musicTimerRef = useRef<number | null>(null)
  const musicStepRef = useRef(0)
  const simulationTimeRef = useRef(0)
  const [mode, setModeState] = useState<GameMode>('playing')
  const [renderTick, setRenderTick] = useState(0)
  const [banner, setBanner] = useState('')
  const [viewportWidth, setViewportWidth] = useState(900)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_GAME_SETTINGS)
  const [storyLoading, setStoryLoading] = useState(false)

  const setMode = useCallback((next: GameMode) => {
    if (next !== 'playing') keysRef.current.clear()
    modeRef.current = next
    setModeState(next)
  }, [])

  const processed = getProcessedImagesForTheme(getThemeId(selectedTheme))
  const levelSpec = spec?.levels[currentLevelIndex]
  const plannedAssets = spec?.assets || []
  const assetFor = useCallback((category: AssetCategory, levelId?: string) => plannedAssets.find((asset) =>
    asset.enabled
    && asset.category === category
    && (!levelId || asset.levelIds.length === 0 || asset.levelIds.includes(levelId)),
  ), [plannedAssets])
  const assetById = useCallback((id: string) => plannedAssets.find((asset) => asset.id === id), [plannedAssets])
  const assets = useMemo(() => {
    const globalUrl = (type: Exclude<AssetType, 'background' | 'ground' | 'obstacle'>) =>
      processed[type] || data?.[`${type}Url`] || ''
    return {
      character: assetFor('hero', levelSpec?.id)?.url || globalUrl('character'),
      enemy: assetFor('groundEnemy', levelSpec?.id)?.url || globalUrl('enemy'),
      weapon: assetFor('meleeWeapon', levelSpec?.id)?.url || globalUrl('weapon'),
      rangedWeapon: assetFor('rangedWeapon', levelSpec?.id)?.url || globalUrl('weapon'),
      projectile: assetFor('rangedProjectile', levelSpec?.id)?.url || globalUrl('projectile'),
      attackEffect: assetFor('meleeAttackEffect', levelSpec?.id)?.url || globalUrl('attackEffect'),
      rangedEffect: assetFor('rangedAttackEffect', levelSpec?.id)?.url || globalUrl('attackEffect'),
      enemyEffect: assetFor('groundEnemyAttackEffect', levelSpec?.id)?.url || globalUrl('attackEffect'),
      collectible: assetFor('collectible', levelSpec?.id)?.url || globalUrl('collectible'),
      boss: assetFor('boss', levelSpec?.id)?.url || globalUrl('boss'),
      background: assetFor('levelBackground', levelSpec?.id)?.url || processed.background || level?.backgroundUrl || '',
      ground: assetFor('groundPlatform', levelSpec?.id)?.url || processed.ground || level?.groundUrl || '',
      water: assetFor('waterPlatform', levelSpec?.id)?.url || '',
      air: assetFor('airPlatform', levelSpec?.id)?.url || '',
      obstacle: assetFor('normalObstacle', levelSpec?.id)?.url || processed.obstacle || level?.obstacleUrl || '',
      deathObstacle: assetFor('deathObstacle', levelSpec?.id)?.url || processed.obstacle || level?.obstacleUrl || '',
      bounceObstacle: assetFor('bounceObstacle', levelSpec?.id)?.url || processed.obstacle || level?.obstacleUrl || '',
    }
  }, [assetFor, processed, data, level, levelSpec?.id])

  const displayPreset = DISPLAY_PRESETS[settings.displaySize]
  const stageHeight = displayPreset.stageHeight
  const groundTop = stageHeight - 122
  const worldWidth = Math.max(1120, viewportWidth)
  const exitX = worldWidth - EXIT_RIGHT_MARGIN - EXIT_WIDTH
  const exitY = groundTop - EXIT_HEIGHT

  useEffect(() => {
    const saved = loadGameSettings()
    settingsRef.current = saved
    setSettings(saved)
  }, [])

  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value }
      settingsRef.current = next
      saveGameSettings(next)
      return next
    })
  }

  const stopMusic = useCallback(() => {
    if (musicTimerRef.current) {
      window.clearInterval(musicTimerRef.current)
      musicTimerRef.current = null
    }
    const context = musicContextRef.current
    if (context?.state === 'running') void context.suspend()
  }, [])

  const startMusic = useCallback(async () => {
    const currentSettings = settingsRef.current
    if (!currentSettings.musicEnabled || currentSettings.masterVolume <= 0 || modeRef.current !== 'playing') return
    type AudioWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }
    const AudioContextClass = window.AudioContext || (window as AudioWindow).webkitAudioContext
    if (!AudioContextClass) return
    if (!musicContextRef.current) {
      const context = new AudioContextClass()
      const masterGain = context.createGain()
      masterGain.gain.value = currentSettings.masterVolume / 100 * 0.08
      masterGain.connect(context.destination)
      musicContextRef.current = context
      musicGainRef.current = masterGain
    }
    const context = musicContextRef.current
    const masterGain = musicGainRef.current
    if (!context || !masterGain) return
    masterGain.gain.setTargetAtTime(settingsRef.current.masterVolume / 100 * 0.08, context.currentTime, 0.08)
    if (context.state === 'suspended') await context.resume()
    if (musicTimerRef.current) return

    const playNote = () => {
      if (context.state !== 'running') return
      const music = levelSpec?.music
      const root = music?.rootFrequency || 130.81
      const scale = music?.scale?.length ? music.scale : [0, 4, 7, 11, 7, 4, 2, 7]
      const notes = scale.map((semitones) => root * 2 ** (semitones / 12))
      const frequency = notes[musicStepRef.current % notes.length] * (1 + currentLevelIndex * 0.015)
      musicStepRef.current += 1
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = 'triangle'
      oscillator.frequency.value = frequency
      envelope.gain.setValueAtTime(0.0001, context.currentTime)
      envelope.gain.exponentialRampToValueAtTime(0.32, context.currentTime + 0.04)
      envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.75)
      oscillator.connect(envelope)
      envelope.connect(masterGain)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.8)
    }
    playNote()
    const tempo = Math.max(45, Math.min(180, levelSpec?.music.tempo || 84))
    musicTimerRef.current = window.setInterval(playNote, Math.round(60000 / tempo))
  }, [currentLevelIndex, levelSpec?.music])

  const playEffectSound = useCallback((asset: AssetDefinition | undefined, fallbackPitch = 440) => {
    const context = musicContextRef.current
    const master = musicGainRef.current
    if (!context || !master || context.state !== 'running' || !settingsRef.current.musicEnabled) return
    const sound = asset?.sound
    const duration = Math.max(0.05, Math.min(1.2, sound?.durationMs ? sound.durationMs / 1000 : 0.15))
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = sound?.waveform || 'square'
    oscillator.frequency.setValueAtTime(sound?.frequency || fallbackPitch, context.currentTime)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, (sound?.frequency || fallbackPitch) + (sound?.pitchSweep || -fallbackPitch * 0.38)), context.currentTime + duration)
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.025, (sound?.volume || 0.45) * 0.22), context.currentTime + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start()
    oscillator.stop(context.currentTime + duration + 0.02)
  }, [])

  useEffect(() => {
    settingsRef.current = settings
    const context = musicContextRef.current
    const masterGain = musicGainRef.current
    if (context && masterGain) {
      masterGain.gain.setTargetAtTime(settings.masterVolume / 100 * 0.08, context.currentTime, 0.08)
    }
    if (!settings.musicEnabled || settings.masterVolume <= 0 || mode !== 'playing') stopMusic()
    else if (context) void startMusic()
  }, [mode, settings, startMusic, stopMusic])

  useEffect(() => () => {
    if (musicTimerRef.current) window.clearInterval(musicTimerRef.current)
    const context = musicContextRef.current
    if (context && context.state !== 'closed') void context.close()
  }, [])

  useEffect(() => {
    const updateSize = () => {
      if (stageRef.current) setViewportWidth(stageRef.current.clientWidth)
    }
    updateSize()
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateSize)
      : null
    if (stageRef.current) resizeObserver?.observe(stageRef.current)
    window.addEventListener('resize', updateSize)
    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  const initializeLevel = useCallback(() => {
    if (!data || !level || !spec) return
    const previousHealth = playerRef.current?.health ?? spec.hero.maxHealth
    const health = currentLevelIndex > 0
      ? Math.min(spec.hero.maxHealth, previousHealth + 15)
      : previousHealth
    playerRef.current = {
      x: 60,
      y: groundTop - PLAYER_HEIGHT,
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
      action: 'idle',
      actionStartedAt: 0,
      actionUntil: 0,
    }
    obstaclesRef.current = (level.obstacles || []).map((obstacle, index) => {
      const width = Math.max(42, Math.min(80, obstacle.width || 48))
      const height = Math.max(42, Math.min(80, obstacle.height || 48))
      const maxX = Math.max(150, worldWidth - EXIT_SAFE_ZONE - width)
      return {
        ...obstacle,
        id: obstacle.id || `obstacle-${index}`,
        width,
        height,
        x: Math.max(150, Math.min(maxX, obstacle.x || 220 + index * 100)),
        y: groundTop - height,
        assetId: assetFor(obstacle.type as AssetCategory, levelSpec?.id)?.id,
        baseY: groundTop - height,
        phase: index * 0.8,
      }
    })
    if (levelSpec?.platformMode === 'air' && assetFor('airPlatform', levelSpec.id)?.enabled) {
      obstaclesRef.current.push(...Array.from({ length: 3 }, (_, index): RuntimeObstacle => ({
        id: `air-platform-${index}`,
        x: 250 + index * 235,
        y: groundTop - 115 - (index % 2) * 65,
        baseY: groundTop - 115 - (index % 2) * 65,
        width: 130,
        height: 32,
        type: 'airPlatform',
        assetId: assetFor('airPlatform', levelSpec.id)?.id,
        phase: index * 1.3,
      })))
    }
    const enemySpec = spec.enemies[0]
    const spawns = level.enemySpawns?.length
      ? level.enemySpawns
      : Array.from({ length: spec.levels[currentLevelIndex]?.enemyCount || 3 }, (_, index) => ({
          id: `enemy-${index}`,
          x: 280 + index * 130,
          y: groundTop - ENEMY_HEIGHT,
          kind: 'enemy',
        }))
    enemiesRef.current = spawns.map((spawn, index): EnemyRuntime => {
      const asset = assetById(spawn.kind) || assetFor('groundEnemy', levelSpec?.id)
      const mobility = asset?.motion?.mobility || (asset?.category === 'airEnemy' ? 'air' : asset?.category === 'waterEnemy' ? 'water' : 'ground')
      const baseY = mobility === 'air' ? groundTop - 175 - (index % 2) * 45 : mobility === 'water' ? groundTop - 74 : groundTop - ENEMY_HEIGHT
      const healthValue = enemySpec.health + currentLevelIndex * 8
      return {
        id: spawn.id,
        x: Math.max(220, Math.min(exitX - 120, spawn.x)),
        y: baseY,
        width: ENEMY_WIDTH,
        height: ENEMY_HEIGHT,
        health: healthValue,
        maxHealth: healthValue,
        damage: enemySpec.damage + currentLevelIndex * 2,
        speed: enemySpec.speed + currentLevelIndex * 0.08,
        direction: index % 2 ? -1 : 1,
        patrolMin: Math.max(150, spawn.x - 100),
        patrolMax: Math.min(worldWidth - 100, spawn.x + 100),
        lastShotAt: 0,
        ranged: enemySpec.behavior === 'ranged' || mobility !== 'ground' || index % 3 === 2,
        isBoss: false,
        assetId: asset?.id || spawn.kind,
        mobility,
        baseY,
        phase: index * 1.15,
        vy: 0,
        onGround: mobility === 'ground',
        nextDecisionAt: 450 + index * 130,
        idleUntil: 450 + index * 130,
        removeAt: 0,
        action: 'idle',
        actionStartedAt: 0,
        actionUntil: 0,
      }
    })
    if (level.bossSpawn) {
      enemiesRef.current.push({
        id: level.bossSpawn.id,
        x: Math.min(exitX - 150, Math.max(600, level.bossSpawn.x)),
        y: groundTop - 94,
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
        assetId: level.bossSpawn.kind,
        mobility: 'boss',
        baseY: groundTop - 94,
        phase: 0,
        vy: 0,
        onGround: true,
        nextDecisionAt: 700,
        idleUntil: 700,
        removeAt: 0,
        action: 'idle',
        actionStartedAt: 0,
        actionUntil: 0,
      })
    }
    collectiblesRef.current = (level.collectibleSpawns || []).map((spawn) => ({
      id: spawn.id,
      x: Math.max(150, Math.min(exitX - 90, spawn.x)),
      y: Math.min(groundTop - 42, spawn.y || groundTop - 100),
      collected: false,
    }))
    projectilesRef.current = []
    effectsRef.current = []
    keysRef.current.clear()
    simulationTimeRef.current = 0
    transitionRef.current = false
    setBanner(`LEVEL ${currentLevelIndex + 1} — ${spec.levels[currentLevelIndex]?.name || ''}`)
    setMode('playing')
    const timer = window.setTimeout(() => setBanner(''), 1500)
    setRenderTick(0)
    return () => window.clearTimeout(timer)
  }, [assetById, assetFor, currentLevelIndex, data, exitX, groundTop, level, levelSpec, setMode, spec, worldWidth])

  useEffect(() => initializeLevel(), [initializeLevel])

  const awardEnemy = useCallback((enemy: EnemyRuntime) => {
    scoreRef.current += enemy.isBoss ? 1000 : 150
  }, [])

  const damageEnemy = useCallback((enemy: EnemyRuntime, damage: number) => {
    if (enemy.health <= 0) return
    const now = simulationTimeRef.current
    enemy.health -= Math.round(damage * powerRef.current)
    if (enemy.health <= 0) {
      enemy.health = 0
      setActorAction(enemy, 'death', now, DEATH_POSE_MS)
      enemy.removeAt = now + DEATH_POSE_MS
      awardEnemy(enemy)
    } else {
      setActorAction(enemy, 'hit', now, HIT_POSE_MS)
    }
  }, [awardEnemy])

  const meleeAttack = useCallback(() => {
    void startMusic()
    const player = playerRef.current
    const currentSpec = gameData.data?.spec
    if (!player || !currentSpec || modeRef.current !== 'playing') return
    const now = simulationTimeRef.current
    if (player.health <= 0 || (player.action === 'hit' && now < player.actionUntil)) return
    if (now < player.meleeReadyAt) return
    player.meleeReadyAt = now + currentSpec.weapon.cooldownMs
    setActorAction(player, 'attack', now, ATTACK_POSE_MS)
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
      kind: 'melee',
    })
    playEffectSound(assetFor('meleeAttackSound', levelSpec?.id), 180)
  }, [assetFor, damageEnemy, gameData.data?.spec, levelSpec?.id, playEffectSound, startMusic])

  const rangedAttack = useCallback(() => {
    void startMusic()
    const player = playerRef.current
    const currentSpec = gameData.data?.spec
    if (!player || !currentSpec || modeRef.current !== 'playing') return
    const now = simulationTimeRef.current
    if (player.health <= 0 || (player.action === 'hit' && now < player.actionUntil)) return
    if (now < player.rangedReadyAt) return
    player.rangedReadyAt = now + Math.max(240, currentSpec.weapon.cooldownMs * 1.2)
    setActorAction(player, 'attack', now, ATTACK_POSE_MS)
    const muzzleX = player.facing === 1 ? player.x + player.width : player.x - 32
    projectilesRef.current.push({
      id: `player-shot-${Date.now()}`,
      x: muzzleX,
      y: player.y + 24,
      width: 24,
      height: 16,
      vx: currentSpec.weapon.projectileSpeed * player.facing,
      damage: currentSpec.weapon.rangedDamage,
      hostile: false,
    })
    effectsRef.current.push({
      id: `muzzle-${Date.now()}`,
      x: muzzleX,
      y: player.y + 6,
      facing: player.facing,
      expiresAt: now + 160,
      kind: 'ranged',
    })
    playEffectSound(assetFor('rangedAttackSound', levelSpec?.id), 620)
  }, [assetFor, gameData.data?.spec, levelSpec?.id, playEffectSound, startMusic])

  const damagePlayer = useCallback((damage: number) => {
    const player = playerRef.current
    if (!player || player.health <= 0) return
    const now = simulationTimeRef.current
    if (now < player.invulnerableUntil) return
    player.health = Math.max(0, player.health - damage)
    setActorAction(player, player.health <= 0 ? 'death' : 'hit', now, player.health <= 0 ? DEATH_POSE_MS : HIT_POSE_MS)
    player.invulnerableUntil = now + 850
  }, [])

  const enterExit = useCallback(() => {
    if (transitionRef.current) return
    transitionRef.current = true
    keysRef.current.clear()
    if (currentLevelIndex >= totalLevels - 1) {
      setMode('victory')
      return
    }
    setMode('transition')
    setBanner(`LEVEL ${currentLevelIndex + 1} CLEAR`)
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = window.setTimeout(() => {
      const advanced = useGameStore.getState().nextLevel()
      transitionRef.current = false
      if (!advanced) setMode('victory')
    }, 850)
  }, [currentLevelIndex, setMode, totalLevels])

  useEffect(() => () => {
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
  }, [])

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (['arrowleft', 'arrowright', ' ', 'j', 'k', 'escape'].includes(key)) event.preventDefault()
      if (key === 'escape') {
        if (modeRef.current === 'playing') setMode('paused')
        else if (modeRef.current === 'paused') setMode('playing')
        return
      }
      if (modeRef.current !== 'playing') return
      void startMusic()
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
  }, [meleeAttack, rangedAttack, setMode, startMusic])

  useEffect(() => {
    if (!data || !level || !spec) return
    let lastRealTime = performance.now()

    const loop = (realNow: number) => {
      const elapsedRealMs = Math.min(34, Math.max(0, realNow - lastRealTime))
      lastRealTime = realNow
      const player = playerRef.current
      if (modeRef.current === 'playing' && player) {
        simulationTimeRef.current += elapsedRealMs
        const now = simulationTimeRef.current
        const delta = Math.min(2, elapsedRealMs / 16.67)
        obstaclesRef.current.forEach((obstacle) => {
          if (obstacle.type === 'airPlatform' && obstacle.baseY !== undefined) {
            obstacle.y = obstacle.baseY + Math.sin(now / 850 + (obstacle.phase || 0)) * 18
          }
        })
        if (player.health <= 0) {
          player.vx = 0
          if (now >= player.actionUntil) setMode('dead')
        } else {
          const reactionLocked = (player.action === 'attack' || player.action === 'hit') && now < player.actionUntil
          const moveLeft = keysRef.current.has('a') || keysRef.current.has('arrowleft')
          const moveRight = keysRef.current.has('d') || keysRef.current.has('arrowright')
          const jump = keysRef.current.has(' ') || keysRef.current.has('w') || keysRef.current.has('arrowup')
          player.vx = reactionLocked ? 0 : (moveRight ? spec.hero.moveSpeed : 0) - (moveLeft ? spec.hero.moveSpeed : 0)
          if (player.vx) player.facing = player.vx > 0 ? 1 : -1
          if (!reactionLocked && jump && player.onGround) {
            player.vy = -spec.hero.jumpPower
            player.onGround = false
          }

          let nextX = Math.max(0, Math.min(worldWidth - player.width, player.x + player.vx * delta))
          const horizontalBox = { ...player, x: nextX }
          const horizontalHit = obstaclesRef.current.find((obstacle) => intersects(horizontalBox, obstacle))
          if (horizontalHit?.type === 'deathObstacle') damagePlayer(player.maxHealth)
          else if (horizontalHit) nextX = player.x
          player.x = nextX

          const gravityScale = levelSpec?.platformMode === 'water' ? 0.34 : levelSpec?.platformMode === 'air' ? 0.68 : 1
          player.vy += 0.82 * gravityScale * delta
          let nextY = player.y + player.vy * delta
          player.onGround = false
          if (nextY + player.height >= groundTop) {
            nextY = groundTop - player.height
            player.vy = 0
            player.onGround = true
          } else if (player.vy >= 0) {
            const previousBottom = player.y + player.height
            for (const obstacle of obstaclesRef.current) {
              const overlapsX = player.x + player.width > obstacle.x && player.x < obstacle.x + obstacle.width
              if (overlapsX && previousBottom <= obstacle.y + 7 && nextY + player.height >= obstacle.y) {
                if (obstacle.type === 'deathObstacle') {
                  damagePlayer(player.maxHealth)
                } else if (obstacle.type === 'bounceObstacle') {
                  nextY = obstacle.y - player.height
                  player.vy = -spec.hero.jumpPower * 1.35
                  player.onGround = false
                } else {
                  nextY = obstacle.y - player.height
                  player.vy = 0
                  player.onGround = true
                }
                break
              }
            }
          }
          player.y = nextY

          if (!reactionLocked || now >= player.actionUntil) {
            if (!player.onGround) setActorAction(player, 'jump', now)
            else if (Math.abs(player.vx) > 0.1) setActorAction(player, 'walk', now)
            else setActorAction(player, 'idle', now)
          }
        }

        enemiesRef.current.forEach((enemy) => {
          if (enemy.health <= 0) return
          const distance = player.x - enemy.x
          if (Math.abs(distance) < (enemy.isBoss ? 480 : 300)) enemy.direction = distance >= 0 ? 1 : -1
          else if (enemy.x <= enemy.patrolMin) enemy.direction = 1
          else if (enemy.x >= enemy.patrolMax) enemy.direction = -1
          const reactionLocked = (enemy.action === 'attack' || enemy.action === 'hit') && now < enemy.actionUntil
          if (!reactionLocked && now >= enemy.nextDecisionAt) {
            enemy.nextDecisionAt = now + (enemy.isBoss ? 2100 : 2700) + enemy.phase * 120
            if ((enemy.mobility === 'ground' || enemy.mobility === 'boss') && enemy.onGround && Math.abs(distance) < 330) {
              enemy.vy = enemy.isBoss ? -10.5 : -7.5
              enemy.onGround = false
            } else {
              enemy.idleUntil = now + (enemy.isBoss ? 620 : 460)
            }
          }
          const resting = now < enemy.idleUntil
          if (!reactionLocked && !resting) {
            const speedScale = enemy.mobility === 'water' ? 0.72 : enemy.mobility === 'air' ? 1.12 : 1
            enemy.x = Math.max(120, Math.min(exitX - enemy.width - 32, enemy.x + enemy.speed * speedScale * enemy.direction * delta))
          }
          if (!reactionLocked) {
            if (enemy.mobility === 'air') {
              const maneuvering = (now + enemy.phase * 900) % 3200 > 2380
              const hover = Math.sin(now / 520 + enemy.phase) * 34
              const dive = maneuvering && Math.abs(distance) < 240 ? Math.min(90, Math.max(0, 240 - Math.abs(distance)) * 0.38) : 0
              enemy.y = Math.max(54, Math.min(groundTop - enemy.height - 24, enemy.baseY + hover + dive))
              setActorAction(enemy, maneuvering ? 'jump' : resting ? 'idle' : 'walk', now)
            } else if (enemy.mobility === 'water') {
              const maneuvering = (now + enemy.phase * 1000) % 3400 > 2550
              const lift = maneuvering ? -30 : 0
              enemy.y = Math.min(groundTop - enemy.height * 0.45, enemy.baseY + Math.sin(now / 630 + enemy.phase) * 22 + lift)
              setActorAction(enemy, maneuvering ? 'jump' : resting ? 'idle' : 'walk', now)
            } else {
              if (!enemy.onGround) {
                enemy.vy += 0.72 * delta
                enemy.y += enemy.vy * delta
                if (enemy.y + enemy.height >= groundTop) {
                  enemy.y = groundTop - enemy.height
                  enemy.vy = 0
                  enemy.onGround = true
                }
              } else enemy.y = groundTop - enemy.height
              setActorAction(enemy, !enemy.onGround ? 'jump' : resting ? 'idle' : 'walk', now)
            }
          }

          const shotDelay = enemy.isBoss ? 1050 : 2200
          if (!reactionLocked && enemy.ranged && Math.abs(distance) < 520 && now - enemy.lastShotAt > shotDelay) {
            enemy.lastShotAt = now
            setActorAction(enemy, 'attack', now, ATTACK_POSE_MS)
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
            const category: AssetCategory = enemy.isBoss
              ? 'bossAttackSound'
              : enemy.mobility === 'air'
                ? 'airEnemyAttackSound'
                : enemy.mobility === 'water'
                  ? 'waterEnemyAttackSound'
                  : 'groundEnemyAttackSound'
            playEffectSound(assetFor(category, levelSpec?.id), enemy.isBoss ? 90 : 240)
          } else if (!reactionLocked && !enemy.ranged && Math.abs(distance) < enemy.width + 24 && now - enemy.lastShotAt > 950) {
            enemy.lastShotAt = now
            setActorAction(enemy, 'attack', now, ATTACK_POSE_MS)
            damagePlayer(enemy.damage)
            playEffectSound(assetFor('groundEnemyAttackSound', levelSpec?.id), 190)
          }
        })

        projectilesRef.current.forEach((shot) => {
          shot.x += shot.vx * delta
          if (shot.hostile) {
            if (intersects(shot, player)) {
              damagePlayer(shot.damage)
              effectsRef.current.push({ id: `enemy-impact-${shot.id}`, x: shot.x - 22, y: shot.y - 24, facing: shot.vx >= 0 ? 1 : -1, expiresAt: now + 180, kind: 'impact', hostile: true })
              shot.x = -9999
            }
          } else {
            const target = enemiesRef.current.find((enemy) => enemy.health > 0 && intersects(shot, enemy))
            if (target) {
              damageEnemy(target, shot.damage)
              effectsRef.current.push({ id: `impact-${shot.id}`, x: target.x - 16, y: target.y - 12, facing: shot.vx >= 0 ? 1 : -1, expiresAt: now + 180, kind: 'impact' })
              shot.x = -9999
            }
          }
          if (obstaclesRef.current.some((obstacle) => intersects(shot, obstacle))) shot.x = -9999
        })
        projectilesRef.current = projectilesRef.current.filter((shot) => shot.x > -100 && shot.x < worldWidth + 100)
        enemiesRef.current = enemiesRef.current.filter((enemy) => enemy.health > 0 || now < enemy.removeAt)
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

        const exitTrigger = {
          x: exitX - 16,
          y: exitY,
          width: EXIT_WIDTH + 32,
          height: EXIT_HEIGHT,
        }
        if (player.health > 0 && enemiesRef.current.length === 0 && intersects(player, exitTrigger)) {
          enterExit()
        }
        setRenderTick(now)
      }
      animationRef.current = requestAnimationFrame(loop)
    }
    animationRef.current = requestAnimationFrame(loop)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [assetFor, damageEnemy, damagePlayer, data, enterExit, exitX, exitY, groundTop, level, levelSpec?.id, levelSpec?.platformMode, playEffectSound, spec, worldWidth])

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
    if (pressed) {
      if (modeRef.current !== 'playing') return
      keysRef.current.add(key)
      void startMusic()
    }
    else keysRef.current.delete(key)
  }

  const openSettings = () => {
    resumeAfterSettingsRef.current = modeRef.current === 'playing'
    if (resumeAfterSettingsRef.current) setMode('paused')
    setSettingsOpen(true)
  }

  const closeSettings = () => {
    setSettingsOpen(false)
    if (resumeAfterSettingsRef.current && modeRef.current === 'paused') {
      setMode('playing')
      window.setTimeout(() => { void startMusic() }, 0)
    }
    resumeAfterSettingsRef.current = false
  }

  const generateBackgroundStory = async () => {
    const currentSpec = useGameStore.getState().gameData.data?.spec
    if (!currentSpec) return
    const prefs = loadImageApiPrefs()
    if (!prefs.apiKey.trim()) {
      message.error('请先在主菜单配置 API Key，再生成新的 AI 背景故事。')
      return
    }
    setStoryLoading(true)
    try {
      const response = await fetch('/api/optimize-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Create a new dramatic background story for this game without changing its established world or characters. World: ${currentSpec.world}. Hero: ${currentSpec.hero.name}, ${currentSpec.hero.appearance}. Important collectible: ${currentSpec.collectible.name}. Final boss: ${currentSpec.boss.name}, ${currentSpec.boss.appearance}.`,
          theme: currentSpec.title,
          levelCount: currentSpec.levels.length,
          provider: prefs.provider,
          apiKey: prefs.apiKey.trim(),
        }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'AI 背景故事生成失败。')
      const story = result.data?.spec?.backgroundStory
      if (typeof story !== 'string' || !story.trim()) throw new Error('没有收到有效的背景故事。')
      const state = useGameStore.getState()
      const currentData = state.getGameDataForTheme(selectedTheme)
      if (!currentData.data) throw new Error('当前主题游戏数据不存在。')
      state.setGameData({
        ...currentData,
        data: {
          ...currentData.data,
          spec: { ...currentData.data.spec, backgroundStory: story.trim() },
        },
      }, selectedTheme)
      if (result.data.source === 'ai') message.success('AI 背景故事已生成并保存。')
      else message.info('当前服务不可用，已保留可靠的本地背景故事。')
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 背景故事生成失败。')
    } finally {
      setStoryLoading(false)
    }
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

  const player = playerRef.current
  const cameraX = player ? Math.max(0, Math.min(worldWidth - viewportWidth, player.x - viewportWidth * 0.42)) : 0
  const boss = enemiesRef.current.find((enemy) => enemy.isBoss)
  const remaining = enemiesRef.current.length
  const levelCleared = remaining === 0
  const playerNearExit = Boolean(player && intersects(player, {
    x: exitX - 54,
    y: exitY - 10,
    width: EXIT_WIDTH + 108,
    height: EXIT_HEIGHT + 20,
  }))

  const renderImage = (url: string, alt: string, style: CSSProperties, fallback: ReactNode) =>
    url ? <img src={url} alt={alt} draggable={false} style={{ ...style, imageRendering: 'pixelated', userSelect: 'none', pointerEvents: 'none' }} /> : fallback
  const heroAsset = assetFor('hero', levelSpec?.id)
  const meleeWeaponAsset = assetFor('meleeWeapon', levelSpec?.id)
  const rangedWeaponAsset = assetFor('rangedWeapon', levelSpec?.id)
  const weather = levelSpec?.effects.weather || ''
  const effectFilters: Record<string, string> = {
    none: '', cold: 'saturate(.9) hue-rotate(12deg)', warm: 'sepia(.18) saturate(1.18)',
    dream: 'saturate(1.16) brightness(1.05)', danger: 'sepia(.2) saturate(1.35) hue-rotate(-12deg)',
    underwater: 'saturate(.86) hue-rotate(16deg) brightness(.9)',
  }
  const levelFilter = effectFilters[levelSpec?.effects.filter || 'none'] || ''
  const filterStyle = `${getGraphicsFilter(settings.graphicsQuality)} ${levelFilter}`.trim()

  return (
    <>
    <Card styles={{ body: { padding: 0 } }} style={{ overflow: 'hidden', background: '#080d1d', width: '100%', maxWidth: displayPreset.maxWidth, margin: '0 auto' }}>
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
            aria-label={mode === 'paused' ? '继续游戏' : '暂停游戏'}
          />
          <Button size="small" icon={<Settings size={14} />} onClick={openSettings} aria-label="打开游戏设置" />
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

      <div ref={stageRef} style={{ position: 'relative', height: stageHeight, overflow: 'hidden', background: '#101527', touchAction: 'none' }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: assets.background ? `linear-gradient(rgba(4,8,20,.08), rgba(4,8,20,.3)), url("${assets.background}")` : 'linear-gradient(#183455, #0b142b)',
          backgroundSize: 'cover',
          backgroundPosition: `${50 - cameraX / worldWidth * 14}% center`,
          imageRendering: 'pixelated',
          filter: levelFilter,
        }} />

        {levelSpec?.platformMode === 'water' && <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '46%',
          backgroundImage: assets.water ? `linear-gradient(rgba(0,132,180,.38), rgba(0,42,92,.68)), url("${assets.water}")` : 'linear-gradient(rgba(0,140,190,.3), rgba(0,38,90,.72))',
          backgroundSize: '180px 90px',
          opacity: 0.78,
          pointerEvents: 'none',
          animation: 'waterDrift 5s linear infinite',
          zIndex: 1,
        }} />}

        {weather && weather !== 'none' && <div aria-label={`Weather effect: ${weather}`} style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 9 }}>
          {Array.from({ length: 22 }, (_, index) => <i key={index} style={{
            position: 'absolute',
            left: `${(index * 47) % 100}%`,
            top: `${-10 - (index % 5) * 14}%`,
            width: weather.includes('snow') ? 5 : 2,
            height: weather.includes('snow') ? 5 : 28,
            borderRadius: weather.includes('snow') ? '50%' : 2,
            background: weather.includes('ash') ? '#b4a49a' : weather.includes('snow') ? '#fff' : '#7fd7ff',
            opacity: 0.72,
            animation: `weatherFall ${1.8 + (index % 6) * 0.34}s linear ${-(index % 7) * 0.25}s infinite`,
          }} />)}
        </div>}

        <div style={{ position: 'absolute', width: worldWidth, height: stageHeight, transform: `translateX(${-cameraX}px)`, willChange: 'transform', filter: filterStyle, zIndex: 2 }}>
          <div style={{
            position: 'absolute',
            left: 0,
            top: groundTop,
            width: worldWidth,
            height: stageHeight - groundTop,
            backgroundImage: assets.ground ? `url("${assets.ground}")` : 'linear-gradient(#5f6f39, #3c3928)',
            backgroundSize: '110px 110px',
            imageRendering: 'pixelated',
            borderTop: '4px solid rgba(220,255,145,.75)',
          }} />

          {obstaclesRef.current.map((obstacle) => {
            const obstacleAsset = obstacle.assetId ? assetById(obstacle.assetId) : undefined
            const obstacleUrl = obstacle.type === 'deathObstacle'
              ? assets.deathObstacle
              : obstacle.type === 'bounceObstacle'
                ? assets.bounceObstacle
                : obstacle.type === 'airPlatform'
                  ? assets.air
                  : assets.obstacle
            return (
            <div key={obstacle.id} style={{ position: 'absolute', left: obstacle.x, top: obstacle.y, width: obstacle.width, height: obstacle.height }}>
              {renderImage(obstacleAsset?.url || obstacleUrl, obstacle.type, { width: '100%', height: '100%', objectFit: 'contain' }, fallbackSprite(obstacle.type === 'deathObstacle' ? 'SPIKE' : obstacle.type === 'bounceObstacle' ? 'BOUNCE' : 'BLOCK', obstacle.type === 'deathObstacle' ? '#a42036' : obstacle.type === 'bounceObstacle' ? '#8e44ad' : '#6d4c41', obstacle.width))}
            </div>
          )})}

          {collectiblesRef.current.filter((item) => !item.collected).map((item) => (
            <div key={item.id} style={{ position: 'absolute', left: item.x, top: item.y, width: 36, height: 36, filter: 'drop-shadow(0 0 8px #77f7ff)', animation: 'pulse 1s infinite alternate' }}>
              {renderImage(assets.collectible, spec.collectible.name, { width: '100%', height: '100%', objectFit: 'contain' }, fallbackSprite('SEED', '#08a88a', 34))}
            </div>
          ))}

          {enemiesRef.current.map((enemy) => {
            const enemyAsset = assetById(enemy.assetId) || assetFor(enemy.isBoss ? 'boss' : enemy.mobility === 'air' ? 'airEnemy' : enemy.mobility === 'water' ? 'waterEnemy' : 'groundEnemy', levelSpec?.id)
            const enemyUrl = enemyAsset?.url || (enemy.isBoss ? assets.boss : assets.enemy)
            return (
            <div key={enemy.id} data-testid={enemy.isBoss ? 'game-boss' : 'game-enemy'} data-action={enemy.action} style={{ position: 'absolute', left: enemy.x, top: enemy.y, width: enemy.width, height: enemy.height }}>
              <div style={{ position: 'absolute', left: 0, top: -9, width: '100%', height: 5, background: '#2b2030', borderRadius: 3 }}>
                <div style={{ width: `${Math.max(0, enemy.health / enemy.maxHealth * 100)}%`, height: '100%', background: enemy.isBoss ? '#ff375f' : '#ff7547', borderRadius: 3 }} />
              </div>
              {plannedSprite(
                enemyAsset,
                enemyUrl,
                enemy.action,
                renderTick,
                enemy.actionStartedAt,
                enemy.actionUntil,
                enemy.isBoss ? spec.boss.name : spec.enemies[0].name,
                { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${enemy.direction === 1 ? -1 : 1})`, filter: 'drop-shadow(0 5px 3px rgba(0,0,0,.55))' },
                fallbackSprite(enemy.isBoss ? 'BOSS' : 'ENEMY', enemy.isBoss ? '#8e2145' : '#9b3a32', enemy.width),
              )}
            </div>
          )})}

          {projectilesRef.current.map((shot) => (
            <div key={shot.id} data-testid="game-projectile" data-hostile={shot.hostile ? 'true' : 'false'} style={{ position: 'absolute', left: shot.x, top: shot.y, width: shot.width, height: shot.height, filter: shot.hostile ? 'hue-rotate(150deg) drop-shadow(0 0 6px #ff3b64)' : 'drop-shadow(0 0 6px #6ee7ff)' }}>
              {renderImage(assets.projectile, 'Projectile', { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${shot.vx < 0 ? -1 : 1})` }, fallbackSprite('•', shot.hostile ? '#ff365e' : '#1fb7f2', shot.width))}
            </div>
          ))}

          {effectsRef.current.map((effect) => (
            <div key={effect.id} style={{ position: 'absolute', left: effect.x, top: effect.y, width: 92, height: 72 }}>
              {renderImage(assets.attackEffect, 'Slash', { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${effect.facing})`, filter: 'drop-shadow(0 0 10px #9fffff)' }, <div style={{ fontSize: 54, color: '#8ff', transform: `scaleX(${effect.facing})` }}>◜</div>)}
            </div>
          ))}

          {player && (
            <div data-testid="game-player" data-action={player.action} style={{
              position: 'absolute',
              left: player.x,
              top: player.y,
              width: player.width,
              height: player.height,
              opacity: renderTick < player.invulnerableUntil && Math.floor(renderTick / 80) % 2 ? 0.35 : 1,
              filter: 'drop-shadow(0 5px 3px rgba(0,0,0,.6))',
            }}>
              {plannedSprite(heroAsset, assets.character, player.action, renderTick, player.actionStartedAt, player.actionUntil, spec.hero.name, { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${player.facing})` }, fallbackSprite('HERO', '#2664c9', 54))}
              <div style={{ position: 'absolute', left: player.facing === 1 ? 34 : -14, top: 25, width: 34, height: 20 }}>
                {renderImage(player.action === 'attack' && assets.rangedWeapon ? rangedWeaponAsset?.url || assets.rangedWeapon : meleeWeaponAsset?.url || assets.weapon, spec.weapon.name, { width: '100%', height: '100%', objectFit: 'contain', transform: `scaleX(${player.facing}) rotate(${player.facing === 1 ? -10 : 10}deg)` }, null)}
              </div>
            </div>
          )}

          <div style={{ position: 'absolute', left: exitX, top: exitY, width: EXIT_WIDTH, height: EXIT_HEIGHT, display: 'grid', placeItems: 'center' }}>
            <div style={{
              width: 54,
              height: 88,
              border: `5px solid ${levelCleared ? '#5df5b2' : '#667085'}`,
              borderRadius: '24px 24px 3px 3px',
              background: levelCleared ? 'radial-gradient(#9dffe0, #0b6c7a 65%, #051c35)' : '#222938',
              boxShadow: levelCleared ? '0 0 24px #52ffc8' : 'none',
            }} />
            <Text style={{ position: 'absolute', bottom: -24, color: '#fff', fontSize: 11 }}>{levelCleared ? 'EXIT' : 'LOCKED'}</Text>
          </div>
        </div>

        {banner && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><div style={{ padding: '14px 28px', color: '#fff', background: 'rgba(5,10,25,.82)', border: '2px solid #61dafb', fontSize: 24, fontWeight: 900, letterSpacing: 2 }}>{banner}</div></div>}

        {playerNearExit && (
          <div style={{ position: 'absolute', left: '50%', bottom: 92, transform: 'translateX(-50%)', zIndex: 14, padding: '8px 14px', borderRadius: 8, color: '#fff', background: levelCleared ? 'rgba(5,112,92,.92)' : 'rgba(120,35,45,.9)', border: `1px solid ${levelCleared ? '#66ffd0' : '#ff8792'}`, fontWeight: 700 }}>
            {levelCleared ? '出口已开启：走入传送门进入下一关' : `出口锁定：还需击败 ${remaining} 个敌人`}
          </div>
        )}

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
          <Button danger size="large" icon={<Swords size={17} />} onClick={meleeAttack}>Slash</Button>
          <Button type="primary" size="large" icon={<Crosshair size={17} />} onClick={rangedAttack}>Shoot</Button>
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
    <Drawer
      className="game-settings-drawer"
      title={<span style={{ color: '#fff' }}>游戏设置</span>}
      open={settingsOpen}
      onClose={closeSettings}
      width={440}
      styles={{
        header: { background: '#10182d', borderBottom: '1px solid #26314b' },
        body: { background: '#0b1122', color: '#fff' },
      }}
    >
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <section>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>画面</Title>
          <Text style={{ color: '#aeb8d0', display: 'block', marginBottom: 10 }}>画面大小</Text>
          <Segmented
            block
            value={settings.displaySize}
            options={(Object.entries(DISPLAY_PRESETS) as Array<[DisplaySize, typeof DISPLAY_PRESETS[DisplaySize]]>).map(([value, preset]) => ({ label: preset.label, value }))}
            onChange={(value) => updateSetting('displaySize', value as DisplaySize)}
          />
          <Text style={{ color: '#aeb8d0', display: 'block', margin: '18px 0 10px' }}>画面效果</Text>
          <Segmented
            block
            value={settings.graphicsQuality}
            options={[
              { label: '流畅', value: 'low' },
              { label: '标准', value: 'medium' },
              { label: '鲜明', value: 'high' },
            ]}
            onChange={(value) => updateSetting('graphicsQuality', value as GameSettings['graphicsQuality'])}
          />
        </section>

        <section>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>音乐</Title>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text style={{ color: '#aeb8d0' }}>启用背景音乐</Text>
            <Switch checked={settings.musicEnabled} onChange={(checked) => updateSetting('musicEnabled', checked)} />
          </Space>
          <Text style={{ color: '#aeb8d0', display: 'block', margin: '16px 0 6px' }}>音乐音量：{settings.masterVolume}%</Text>
          <Slider
            min={0}
            max={100}
            value={settings.masterVolume}
            disabled={!settings.musicEnabled}
            onChange={(value) => updateSetting('masterVolume', value)}
          />
        </section>

        <section>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>基本操作指南</Title>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Text style={{ color: '#dce5f8' }}><Tag color="blue">A / D　← / →</Tag>左右移动</Text>
            <Text style={{ color: '#dce5f8' }}><Tag color="cyan">W / Space / ↑</Tag>跳跃</Text>
            <Text style={{ color: '#dce5f8' }}><Tag color="volcano">J</Tag>近战攻击</Text>
            <Text style={{ color: '#dce5f8' }}><Tag color="purple">K / F</Tag>远程攻击</Text>
            <Text style={{ color: '#dce5f8' }}><Tag>ESC</Tag>暂停或继续</Text>
            <Text style={{ color: '#dce5f8' }}>击败当前关卡的全部敌人后，走入右侧发光传送门即可进入下一关。</Text>
          </Space>
        </section>

        <section>
          <Title level={5} style={{ color: '#fff', marginTop: 0 }}>AI 世界背景故事</Title>
          <Card size="small" style={{ background: '#121c33', borderColor: '#2b3b61' }}>
            <Text style={{ color: '#dce5f8', whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{spec.backgroundStory}</Text>
          </Card>
          <Button type="primary" loading={storyLoading} onClick={() => { void generateBackgroundStory() }} style={{ marginTop: 12 }}>
            AI 重新生成背景故事
          </Button>
        </section>
      </Space>
    </Drawer>
    </>
  )
}

export default GameCanvas
