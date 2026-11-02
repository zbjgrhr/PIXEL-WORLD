import type { CharacterProfile, CharacterRosterSpec, CharacterRosterState, HeroSpec, MapRect } from '@/types'
import { heroPhysics } from './hero-physics'

function createCharacterRosterRules(physics: typeof heroPhysics) {
  const number = (n: unknown, min: number, max: number, field: string) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw Error('Invalid character ' + field); return n }
  function validate(value: unknown): CharacterRosterSpec {
    const r = value as CharacterRosterSpec
    if (!r || r.version !== 1 || !Array.isArray(r.characters) || !r.characters.length || r.characters.length > 8 || typeof r.allowSwitch !== 'boolean' || !['keep','cycle','weighted'].includes(r.respawn)) throw Error('Invalid character roster')
    if (Object.keys(r).some(k => !['version','initialId','allowSwitch','respawn','seed','characters'].includes(k))) throw Error('Unsupported roster field')
    const ids = new Set<string>()
    const characters = r.characters.map(c => {
      if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(c.id) || ids.has(c.id) || ['__proto__','constructor','prototype'].includes(c.id)) throw Error('Invalid or duplicate character ID')
      ids.add(c.id)
      if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 120 || c.assetId !== undefined && (typeof c.assetId !== 'string' || c.assetId.length > 100)) throw Error('Invalid character identity')
      if (Object.keys(c).some(k => !['id','name','assetId','maxHealth','moveSpeed','jumpPower','physics','width','height','meleeMultiplier','rangedMultiplier','weight'].includes(k))) throw Error('Unsupported character field')
      return { id: c.id, name: c.name.trim(), assetId: c.assetId, maxHealth: number(c.maxHealth,1,1000,'health'), moveSpeed: number(c.moveSpeed,0.1,20,'speed'), jumpPower: number(c.jumpPower,1,60,'jump'), width: number(c.width,8,160,'width'), height: number(c.height,8,240,'height'), meleeMultiplier: number(c.meleeMultiplier,0,5,'melee'), rangedMultiplier: number(c.rangedMultiplier,0,5,'ranged'), weight: number(c.weight,0,100,'weight'), physics: c.physics ? physics.validate(c.physics) : undefined }
    })
    if (!ids.has(r.initialId) || !Number.isInteger(r.seed) || r.seed < 1 || r.seed > 0xffffffff || r.respawn === 'weighted' && !characters.some(c => c.weight > 0)) throw Error('Invalid initial character, seed or draw weights')
    return { version: 1, initialId: r.initialId, allowSwitch: r.allowSwitch, respawn: r.respawn, seed: r.seed, characters }
  }
  function fresh(r: CharacterRosterSpec): CharacterRosterState { return { characterId: r.initialId, seed: r.seed, draws: 0 } }
  function restore(r: CharacterRosterSpec, value: unknown): CharacterRosterState {
    const s = value as CharacterRosterState
    return s && r.characters.some(c => c.id === s.characterId) && Number.isInteger(s.seed) && s.seed > 0 && s.seed <= 0xffffffff && Number.isInteger(s.draws) && s.draws >= 0 && s.draws < 1e9 ? { characterId:s.characterId, seed:s.seed, draws:s.draws } : fresh(r)
  }
  function choose(r: CharacterRosterSpec, s: CharacterRosterState, reason: 'switch' | 'respawn'): CharacterRosterState {
    if (reason === 'switch' && !r.allowSwitch || reason === 'respawn' && r.respawn === 'keep') return { ...s }
    if (reason === 'switch' || r.respawn === 'cycle') return { ...s, characterId: r.characters[(r.characters.findIndex(c => c.id === s.characterId) + 1) % r.characters.length].id }
    let seed = s.seed >>> 0; seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0
    let target = seed / 4294967296 * r.characters.reduce((sum,c) => sum + c.weight, 0)
    const chosen = r.characters.filter(c => c.weight > 0).find(c => { target -= c.weight; return target < 0 }) || r.characters.find(c => c.weight > 0)!
    return { characterId: chosen.id, seed, draws: s.draws + 1 }
  }
  function effective(hero: HeroSpec, state?: CharacterRosterState) {
    const c = hero.roster?.characters.find(c => c.id === (state?.characterId || hero.roster?.initialId))
    return { ...hero, ...c, physics: c?.physics || hero.physics, meleeMultiplier: c?.meleeMultiplier ?? 1, rangedMultiplier: c?.rangedMultiplier ?? 1, assetId: c?.assetId }
  }
  function resized(actor: MapRect, profile: CharacterProfile): MapRect { return { x: actor.x + (actor.width - profile.width) / 2, y: actor.y + actor.height - profile.height, width: profile.width, height: profile.height } }
  return { validate, fresh, restore, choose, effective, resized }
}
export const characterRosterRules = createCharacterRosterRules(heroPhysics)
export function offlineCharacterRosterSource() { return `const characterRosterRules=(${createCharacterRosterRules.toString()})(heroPhysics);` }
