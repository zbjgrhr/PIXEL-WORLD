import type { AuthoredLevelMap, MapRect, ObstacleData, MapMechanism, MapMechanismState } from '@/types'

/** Shared, import-free geometry rules for the live and offline engines. */
function createAuthoredMapRules() {
  function validate(candidate: unknown): AuthoredLevelMap {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw Error('Map must be an object')
    const m = candidate as AuthoredLevelMap
    const allowed = ['version','width','height','groundY','player','exit','obstacles','enemies','collectibles','boss','mechanisms','checkpoints']
    if (Object.keys(m).some(key => !allowed.includes(key))) throw Error('Unsupported map field')
    const finite = (n: unknown, min: number, max: number, field: string): number => {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw Error(`Invalid map.${field}`)
      return n
    }
    if (m.version !== 1 && m.version !== 2) throw Error('Unsupported map version')
    if (m.version === 1 && (m.mechanisms !== undefined || m.checkpoints !== undefined)) throw Error('Mechanisms and checkpoints require map version 2')
    const width = finite(m.width, 320, 32768, 'width'), height = finite(m.height, 240, 32768, 'height')
    const rect = (v: MapRect, field: string): MapRect => {
      if (!v || typeof v !== 'object') throw Error(`Invalid map.${field}`)
      if (Object.keys(v).some(key => !['x','y','width','height','id','type','kind','patrolMin','patrolMax'].includes(key))) throw Error(`Unsupported map.${field} field`)
      const x = finite(v.x, 0, width, field + '.x'), y = finite(v.y, 0, height, field + '.y')
      return { x, y, width: finite(v.width, 1, width - x, field + '.width'), height: finite(v.height, 1, height - y, field + '.height') }
    }
    const ids = new Set<string>()
    const identity = (id: unknown) => {
      if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || ['__proto__','constructor','prototype'].includes(id) || ids.has(id)) throw Error('Map object IDs must be unique and use letters, numbers, underscores or hyphens')
      ids.add(id); return id
    }
    const list = <T,>(value: T[], field: string) => {
      if (!Array.isArray(value) || value.length > 512) throw Error(`Invalid map.${field}: maximum 512 entries`)
      return value
    }
    const spawn = (s: AuthoredLevelMap['enemies'][number]) => {
      if (!s || typeof s.kind !== 'string' || !/^[\w-]{1,100}$/.test(s.kind)) throw Error('Invalid map spawn kind')
      const r = rect(s, 'spawn')
      const patrolMin = s.patrolMin === undefined ? undefined : finite(s.patrolMin, 0, width - r.width, 'patrolMin')
      const patrolMax = s.patrolMax === undefined ? undefined : finite(s.patrolMax, 0, width - r.width, 'patrolMax')
      if (patrolMin !== undefined && patrolMax !== undefined && patrolMin > patrolMax) throw Error('Patrol minimum exceeds maximum')
      return { ...r, id: identity(s.id), kind: s.kind, patrolMin, patrolMax }
    }
    const obstacles = list(m.obstacles, 'obstacles').map(o => {
      if (!o || !['normalObstacle', 'bounceObstacle', 'deathObstacle', 'platform'].includes(o.type)) throw Error('Unsupported map obstacle type')
      return { ...rect(o, 'obstacle'), id: identity(o.id), type: o.type }
    })
    const player = rect(m.player, 'player'), exit = rect(m.exit, 'exit')
    if (obstacles.some(o => overlaps(player, o))) throw Error('Player spawn overlaps an obstacle')
    const mechanisms = m.mechanisms === undefined ? undefined : list(m.mechanisms, 'mechanisms').map(v => {
      if (!v || !['movingPlatform','trap','freeze','reverse'].includes(v.kind)) throw Error('Unsupported map mechanism kind')
      const fields = ['x','y','width','height','id','kind', ...(v.kind === 'movingPlatform' ? ['axis','distance','speed'] : v.kind === 'trap' ? ['delayMs','durationMs','cooldownMs'] : ['durationMs','cooldownMs'])]
      if (Object.keys(v).some(k => !fields.includes(k))) throw Error('Unsupported mechanism field')
      const r = rect({ x: v.x, y: v.y, width: v.width, height: v.height }, 'mechanism'), id = identity(v.id)
      if (v.kind === 'movingPlatform') {
        if (v.axis !== 'x' && v.axis !== 'y') throw Error('Invalid mechanism axis')
        const distance = finite(v.distance, -32768, 32768, 'distance'), speed = finite(v.speed, 0.1, 20, 'speed')
        if (distance === 0) throw Error('Platform travel must not be zero')
        const end = { ...r, [v.axis]: r[v.axis] + distance }
        rect(end, 'platform endpoint')
        if (overlaps(player, r) || overlaps(player, end)) throw Error('Player spawn overlaps a moving platform endpoint')
        return { ...r, id, kind: v.kind, axis: v.axis, distance, speed } as MapMechanism
      }
      return { ...r, id, kind: v.kind, durationMs: finite(v.durationMs, 100, 60000, 'durationMs'), cooldownMs: finite(v.cooldownMs, 0, 60000, 'cooldownMs'), ...(v.kind === 'trap' ? { delayMs: finite(v.delayMs, 0, 10000, 'delayMs') } : {}) } as MapMechanism
    })
    const result: AuthoredLevelMap = { version: m.version, width, height, groundY: m.groundY === null ? null : finite(m.groundY, 0, height, 'groundY'), player, exit, obstacles,
      enemies: list(m.enemies, 'enemies').map(spawn), collectibles: list(m.collectibles, 'collectibles').map(spawn), boss: m.boss ? spawn(m.boss) : undefined }
    if (mechanisms !== undefined) result.mechanisms = mechanisms
    if (m.checkpoints !== undefined) result.checkpoints = list(m.checkpoints, 'checkpoints').map(c => {
      if (!c || Object.keys(c).some(k => !['x','y','width','height','id','respawn'].includes(k))) throw Error('Unsupported checkpoint field')
      const r = rect({ x: c.x, y: c.y, width: c.width, height: c.height }, 'checkpoint')
      if (!c.respawn || Object.keys(c.respawn).some(k => !['x','y'].includes(k))) throw Error('Invalid checkpoint respawn')
      const respawn = rect({ ...player, x: c.respawn.x, y: c.respawn.y }, 'checkpoint respawn')
      if (obstacles.some(o => overlaps(respawn, o)) || mechanisms?.some(m => m.kind === 'movingPlatform' && (overlaps(respawn, m) || overlaps(respawn, { ...m, [m.axis]: m[m.axis] + m.distance }))) || result.groundY !== null && respawn.y + respawn.height > result.groundY) throw Error('Checkpoint respawn overlaps solid geometry')
      return { ...r, id: identity(c.id), respawn: { x: respawn.x, y: respawn.y } }
    })
    if (ids.size > 512) throw Error('Map exceeds 512 objects')
    if (result.groundY !== null && player.y + player.height > result.groundY) throw Error('Player spawn is below the ground')
    return result
  }
  function overlaps(a: MapRect, b: MapRect) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y }
  function move(actor: MapRect & { vx: number; vy: number }, solids: ObstacleData[], delta: number, gravity: number, map: AuthoredLevelMap, jumpPower: number) {
    let x = Math.max(0, Math.min(map.width - actor.width, actor.x + actor.vx * delta)), y = actor.y, vy = actor.vy + gravity * delta
    let dead = false, onGround = false
    for (const o of solids) {
      if (actor.y + actor.height <= o.y || actor.y >= o.y + o.height) continue
      if (actor.vx > 0 && actor.x + actor.width <= o.x && x + actor.width > o.x) { x = Math.min(x, o.x - actor.width); dead ||= o.type === 'deathObstacle' }
      else if (actor.vx < 0 && actor.x >= o.x + o.width && x < o.x + o.width) { x = Math.max(x, o.x + o.width); dead ||= o.type === 'deathObstacle' }
    }
    const nextY = y + vy * delta
    y = nextY
    let landed: ObstacleData | undefined
    for (const o of solids) {
      if (x + actor.width <= o.x || x >= o.x + o.width) continue
      if (vy >= 0 && actor.y + actor.height <= o.y + 0.01 && nextY + actor.height >= o.y && o.y - actor.height <= y) { y = o.y - actor.height; landed = o }
      else if (vy < 0 && actor.y >= o.y + o.height && nextY < o.y + o.height) { y = Math.max(y, o.y + o.height); vy = 0; dead ||= o.type === 'deathObstacle' }
    }
    if (landed) { dead ||= landed.type === 'deathObstacle'; vy = landed.type === 'bounceObstacle' ? -jumpPower * 1.35 : 0; onGround = landed.type !== 'bounceObstacle' }
    if (map.groundY !== null && y + actor.height >= map.groundY && actor.y + actor.height <= map.groundY + 0.01) { y = map.groundY - actor.height; vy = 0; onGround = true }
    dead ||= y > map.height || solids.some(o => o.type === 'deathObstacle' && overlaps({ ...actor, x, y }, o))
    return { x, y, vx: actor.vx, vy, onGround, dead }
  }
  function storyPoint(map: AuthoredLevelMap, position: number) { return { x: Math.max(0, Math.min(map.width - 26, 120 + (map.exit.x - 220) * position)), y: (map.groundY ?? map.exit.y + map.exit.height) - 85 } }
  function freshMechanisms(): MapMechanismState { return { entries: {} } }
  function restoreMechanisms(map: AuthoredLevelMap, candidate: unknown): MapMechanismState {
    if (!candidate || typeof candidate !== 'object') return freshMechanisms()
    const entries = (candidate as MapMechanismState).entries
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 512) return freshMechanisms()
    const result = freshMechanisms()
    if (map.checkpoints?.some(c => c.id === (candidate as MapMechanismState).checkpointId)) result.checkpointId = (candidate as MapMechanismState).checkpointId
    for (const m of map.mechanisms || []) {
      const e = Object.prototype.hasOwnProperty.call(entries, m.id) ? entries[m.id] : undefined
      if (e && typeof e.inside === 'boolean' && [e.activatedAt,e.nextAt].every(n => Number.isFinite(n) && n >= -1 && n <= 1e12)) result.entries[m.id] = { inside: e.inside, activatedAt: e.activatedAt, nextAt: e.nextAt }
    }
    return result
  }
  function platformAt(m: Extract<MapMechanism, { kind: 'movingPlatform' }>, now: number): ObstacleData {
    const distance = Math.abs(m.distance), phase = (Math.max(0, now) / 16.67 * m.speed) % (distance * 2)
    return { id: m.id, x: m.x + (m.axis === 'x' ? Math.sign(m.distance) * (phase <= distance ? phase : distance * 2 - phase) : 0), y: m.y + (m.axis === 'y' ? Math.sign(m.distance) * (phase <= distance ? phase : distance * 2 - phase) : 0), width: m.width, height: m.height, type: 'platform' }
  }
  /** Timers use simulation time: pause/story dialogs do not consume durations. Entry triggers require leaving before rearming. */
  function mechanismFrame(map: AuthoredLevelMap, state: MapMechanismState, actor: MapRect, now: number, elapsedMs: number) {
    const solids = [...map.obstacles], visuals: Array<MapRect & { id: string; kind: MapMechanism['kind']; active: boolean; warning: boolean }> = []
    const platforms: Array<{ before: ObstacleData; after: ObstacleData }> = []
    let frozen = false, reversed = false
    for (const c of map.checkpoints || []) if (overlaps(actor, c)) state.checkpointId = c.id
    for (const m of map.mechanisms || []) {
      if (m.kind === 'movingPlatform') {
        const after = platformAt(m, now); solids.push(after); platforms.push({ before: platformAt(m, now - elapsedMs), after })
        visuals.push({ ...after, kind: m.kind, active: true, warning: false }); continue
      }
      const e = state.entries[m.id] || (state.entries[m.id] = { inside: false, activatedAt: -1, nextAt: 0 }), inside = overlaps(actor, m)
      if (inside && !e.inside && now >= e.nextAt) { e.activatedAt = now; e.nextAt = now + (m.kind === 'trap' ? m.delayMs : 0) + m.durationMs + m.cooldownMs }
      e.inside = inside
      const start = e.activatedAt + (m.kind === 'trap' ? m.delayMs : 0)
      const active = e.activatedAt >= 0 && now >= start && now < start + m.durationMs
      if (m.kind === 'trap' && active) solids.push({ ...m, type: 'deathObstacle' })
      frozen ||= m.kind === 'freeze' && active; reversed ||= m.kind === 'reverse' && active
      visuals.push({ ...m, active, warning: e.activatedAt >= 0 && now < start })
    }
    return { solids, visuals, platforms, frozen, reversed, checkpointId: state.checkpointId }
  }
  /** Carry riders and push actors; blocked movement crushes instead of clipping through geometry. */
  function transport(actor: MapRect & { vx: number; vy: number; onGround: boolean }, frame: ReturnType<typeof mechanismFrame>, map: AuthoredLevelMap) {
    let result = { ...actor }, dead = false
    for (const p of frame.platforms) {
      const dx = p.after.x - p.before.x, dy = p.after.y - p.before.y
      const rider = result.onGround && Math.abs(result.y + result.height - p.before.y) < 0.1 && result.x + result.width > p.before.x && result.x < p.before.x + p.before.width
      let x = result.x, y = result.y
      if (rider) { x += dx; y += dy }
      else if (overlaps(result, { x: Math.min(p.before.x, p.after.x), y: Math.min(p.before.y, p.after.y), width: p.after.width + Math.abs(dx), height: p.after.height + Math.abs(dy) })) {
        if (dx > 0) x = p.after.x + p.after.width; else if (dx < 0) x = p.after.x - result.width
        if (dy > 0) y = p.after.y + p.after.height; else if (dy < 0) y = p.after.y - result.height
      }
      if (x !== result.x || y !== result.y) {
        const others = frame.solids.filter(o => o.id !== p.after.id)
        const moved = move({ ...result, vx: x - result.x, vy: y - result.y }, others, 1, 0, map, 0)
        dead ||= moved.dead || Math.abs(moved.x - x) > 0.1 || Math.abs(moved.y - y) > 0.1 || others.some(o => overlaps({ ...result, x: moved.x, y: moved.y }, o))
        result = { ...result, x: moved.x, y: moved.y }
      }
    }
    return { ...result, dead }
  }
  return { validate, overlaps, move, storyPoint, freshMechanisms, restoreMechanisms, mechanismFrame, transport }
}
export const authoredMapRules = createAuthoredMapRules()
export function offlineAuthoredMapSource() { return `const authoredMapRules=(${createAuthoredMapRules.toString()})();` }
