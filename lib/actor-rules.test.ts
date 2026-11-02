import { afterEach, describe, expect, it, vi } from 'vitest'
import { characterRosterRules, offlineCharacterRosterSource } from './character-roster'
import { behaviorProgramRules, offlineBehaviorProgramSource } from './behavior-program'
import { offlineHeroPhysicsSource } from './hero-physics'
import { createFallbackGameSpec, normalizeGameSpec } from './game-spec'
import { narrativeEngine } from './narrative-runtime'
import { referenceFingerprint } from './reference-analysis'
import { inspectGameSpec } from './agents/validation'
import { bootOfflineMap } from './test-support/offline-map'
import type { AuthoredLevelMap, BehaviorProgram, BehaviorStage, CharacterRosterSpec } from '@/types'

const roster = (): CharacterRosterSpec => ({version:1,initialId:'regular',allowSwitch:true,respawn:'weighted',seed:12345,characters:[
  {id:'regular',name:'Regular',maxHealth:120,moveSpeed:2,jumpPower:9,width:32,height:64,meleeMultiplier:1,rangedMultiplier:1,weight:0},
  {id:'runner',name:'Runner',maxHealth:200,moveSpeed:8,jumpPower:12,width:64,height:64,meleeMultiplier:0,rangedMultiplier:2,weight:1,physics:{acceleration:0,gravity:0.5,airControl:1,jumpCount:2,releaseJumpSpeed:4,runUpBoost:0,runUpLimit:0}},
]})
const stage = (patch: Partial<BehaviorStage> = {}): BehaviorStage => ({id:'first',label:'First',triggerDistance:0,triggerAbove:false,warningMs:100,activeMs:200,cooldownMs:100,repeats:1,motion:'still',dx:0,dy:0,speed:2,leash:100,attack:'ranged',attackEveryMs:100,vulnerable:true,transition:'time',healthBelow:0.5,...patch})
const program = (stages: BehaviorStage[] = [stage()]): BehaviorProgram => ({version:1,loop:false,onDefeat:'remove',stages})
const map = (): AuthoredLevelMap => ({version:2,width:1600,height:720,groundY:400,player:{x:80,y:336,width:32,height:64},exit:{x:1400,y:304,width:64,height:96},obstacles:[],enemies:[],collectibles:[]})
afterEach(()=>vi.unstubAllGlobals())

describe('character and behavior contracts',()=>{
  it('bounds profiles and programs, rejects duplicates and unusable draws',()=>{
    expect(characterRosterRules.validate(roster()).characters).toHaveLength(2)
    expect(()=>characterRosterRules.validate({...roster(),characters:roster().characters.map(c=>({...c,weight:0}))})).toThrow('weights')
    expect(()=>characterRosterRules.validate({...roster(),characters:[roster().characters[0],roster().characters[0]]})).toThrow('duplicate')
    expect(()=>characterRosterRules.validate({...roster(),characters:[{...roster().characters[0],height:Infinity}]})).toThrow('height')
    expect(()=>behaviorProgramRules.validate(program([stage({activeMs:Infinity})]))).toThrow('activeMs')
    expect(()=>behaviorProgramRules.validate(program([stage({repeats:1.2})]))).toThrow('integral')
  })
  it('replays weighted draws from saved state and excludes zero-weight characters',()=>{
    const r=roster(),first=characterRosterRules.choose(r,characterRosterRules.fresh(r),'respawn')
    expect(first.characterId).toBe('runner');expect(first.draws).toBe(1)
    const saved=characterRosterRules.restore(r,JSON.parse(JSON.stringify(first)))
    expect(characterRosterRules.choose(r,saved,'respawn')).toEqual(characterRosterRules.choose(r,first,'respawn'))
    expect(characterRosterRules.choose({...r,allowSwitch:false},first,'switch')).toEqual(first)
    expect(characterRosterRules.restore(r,{characterId:'foreign',seed:0,draws:NaN})).toEqual(characterRosterRules.fresh(r))
  })
  it('protects player-authored rules during model normalization and invalidates prior saves and confirmations',()=>{
    const spec=createFallbackGameSpec('Rules','Rules',1),oldKey=narrativeEngine.key(spec),oldFingerprint=referenceFingerprint(spec)
    spec.hero.roster=roster();spec.boss.program=program()
    const proposed=structuredClone(spec);proposed.hero.roster!.characters[0].moveSpeed=19;proposed.boss.program!.stages[0].activeMs=9000
    const normalized=normalizeGameSpec(proposed,spec)
    expect(normalized.hero.roster!.characters[0].moveSpeed).toBe(2)
    expect(normalized.boss.program!.stages[0].activeMs).toBe(200)
    // The runtime keys cache immutable GameSpec identities, so compare a new spec object.
    expect(narrativeEngine.key({...spec})).not.toBe(oldKey)
    expect(referenceFingerprint(spec)).not.toBe(oldFingerprint)
    spec.levels[0].map={...map(),obstacles:[{id:'wall',type:'platform',x:120,y:300,width:10,height:100}]}
    expect(inspectGameSpec(spec).some(i=>i.path==='actorRules'&&i.severity==='blocking')).toBe(true)
  })
  it('runs the same state transitions in offline scope, including warning, cooldown and non-looping completion',()=>{
    const offline=new Function(offlineBehaviorProgramSource()+';return behaviorProgramRules')() as typeof behaviorProgramRules
    const p=program(),actor={x:300,y:336,width:64,height:64,health:100,maxHealth:100},a=behaviorProgramRules.fresh(actor),b=offline.fresh(actor)
    const phases:string[]=[]
    for(const now of [0,50,100,200,310,400,450,1000]){const f=behaviorProgramRules.step(p,a,actor,actor,now,1);expect(offline.step(p,b,actor,actor,now,1)).toEqual(f);phases.push(f.phase)}
    expect(phases).toEqual(['warning','warning','active','active','cooldown','finished','finished','finished'])
    const rosterOffline=new Function(offlineHeroPhysicsSource()+';'+offlineCharacterRosterSource()+';return characterRosterRules')() as typeof characterRosterRules
    expect(rosterOffline.choose(roster(),rosterOffline.fresh(roster()),'respawn')).toEqual(characterRosterRules.choose(roster(),characterRosterRules.fresh(roster()),'respawn'))
  })
  it('supports health transitions, repeated geometry, vulnerability and persistent terminal hazards',()=>{
    const p=program([stage({repeats:2,motion:'stretch',dy:-100,vulnerable:false}),stage({id:'hunt',transition:'health',healthBelow:0.5,motion:'chase'}),stage({id:'terminal',attack:'contact',vulnerable:false})]),actor={x:300,y:336,width:64,height:64,health:100,maxHealth:100},state=behaviorProgramRules.fresh(actor)
    behaviorProgramRules.step(p,state,actor,actor,0,1)
    expect(behaviorProgramRules.step(p,state,actor,actor,200,1)).toMatchObject({height:114,y:286})
    behaviorProgramRules.step(p,state,actor,actor,400,1);expect(state.index).toBe(0);expect(state.repeat).toBe(1)
    behaviorProgramRules.step(p,state,actor,actor,401,1);behaviorProgramRules.step(p,state,actor,actor,801,1);expect(state.index).toBe(1)
    behaviorProgramRules.step(p,state,actor,actor,802,1)
    behaviorProgramRules.step(p,state,{...actor,health:49},actor,903,1);expect(state.index).toBe(2)
    p.onDefeat='hazard';expect(behaviorProgramRules.defeat(p,state)).toBe(true)
    expect(behaviorProgramRules.canDamage(p,state)).toBe(false)
    expect(behaviorProgramRules.step(p,state,actor,actor,2000,1)).toMatchObject({resolved:true,contact:true})
  })
})

describe('actual exported character and behavior runtime',()=>{
  it('uses per-character speed/size, preserves health and cooldown on switching and saves selection',async()=>{
    const setup=(s:ReturnType<typeof createFallbackGameSpec>)=>{s.hero.roster=roster()}
    const game=await bootOfflineMap(map(),undefined,setup)
    expect(game.read().player).toMatchObject({hp:120,w:32,h:64})
    game.key('d');game.tick(2);game.key('d',false);expect(game.read().player.x).toBe(84)
    game.key('j');const ready=game.read().player.meleeReady;game.tick(22)
    game.key('c');expect(game.read().rosterState?.characterId).toBe('runner')
    expect(game.read().player).toMatchObject({hp:120,w:64,meleeReady:ready})
    game.tick(40);game.key('j');expect(game.read().player.meleeReady).toBe(ready)
    const saved=game.save(),restored=await bootOfflineMap(map(),saved,setup)
    expect(restored.read().rosterState?.characterId).toBe('runner')
    expect(restored.read().player.w).toBe(64)
  })
  it('rejects a switch whose new collider would enter a wall',async()=>{
    const m=map();m.obstacles=[{id:'wall',type:'normalObstacle',x:120,y:300,width:10,height:100}]
    const game=await bootOfflineMap(m,undefined,s=>{s.hero.roster=roster()})
    game.key('c');expect(game.read().rosterState?.characterId).toBe('regular');expect(game.read().player.w).toBe(32)
  })
  it('preserves airborne velocity when switching, preventing repeated swaps from suspending a fall',async()=>{
    const game=await bootOfflineMap(map(),undefined,s=>{s.hero.roster=roster()})
    game.key('w');game.tick(2);const vy=game.read().player.vy
    expect(vy).toBeLessThan(0)
    game.key('c');expect(game.read().rosterState?.characterId).toBe('runner');expect(game.read().player.vy).toBe(vy)
  })
  it('draws a character on trap death while retaining the checkpoint respawn',async()=>{
    const m=map();m.mechanisms=[{id:'trap',kind:'trap',x:60,y:300,width:90,height:100,delayMs:100,durationMs:100,cooldownMs:100}];m.checkpoints=[{id:'cp',x:70,y:300,width:60,height:100,respawn:{x:300,y:336}}]
    const game=await bootOfflineMap(m,undefined,s=>{s.hero.roster=roster()});game.tick(53)
    expect(game.read().rosterState).toMatchObject({characterId:'runner',draws:1})
    expect(game.read().player).toMatchObject({x:284,hp:200,w:64})
    expect(game.read().mechanismState.checkpointId).toBe('cp')
  })
  it('blocks damage in an invulnerable warning stage and restores a later program phase',async()=>{
    const m=map();m.boss={id:'boss-1',kind:'boss',x:150,y:336,width:64,height:64}
    const configure=(s:ReturnType<typeof createFallbackGameSpec>)=>{s.boss.program=program([stage({vulnerable:false}),stage({id:'second',label:'Second',warningMs:0,activeMs:5000,attack:'none'})]);s.levels[0].hasBoss=true}
    const game=await bootOfflineMap(m,undefined,configure);game.tick();const hp=game.read().enemies[0].hp;game.key('j')
    expect(game.read().enemies[0].hp).toBe(hp)
    game.tick(26);expect(game.read().enemies[0].programState?.index).toBe(1)
    const save=game.save(),loaded=await bootOfflineMap(m,save,configure)
    expect(loaded.read().enemies[0].programState?.index).toBe(1)
    loaded.tick();expect(loaded.read().enemies[0].programLabel).toBe('Second')
  })
  it('awards defeat only once while leaving a terminal danger in the game',async()=>{
    const m=map();m.boss={id:'boss-1',kind:'boss',x:150,y:336,width:64,height:64};m.exit={x:80,y:336,width:32,height:64}
    const game=await bootOfflineMap(m,undefined,s=>{s.boss.health=10;s.weapon.meleeDamage=100;s.boss.program={...program([stage({warningMs:0,attack:'none',activeMs:50000}),stage({id:'terminal',attack:'contact',vulnerable:false})]),onDefeat:'hazard'};s.levels[0].hasBoss=true})
    game.tick();game.key('j');expect(game.read().score).toBe(1000)
    expect(game.read().enemies[0].programState?.resolved).toBe(true)
    game.tick(30);game.key('j');expect(game.read().score).toBe(1000)
    expect(game.read().enemies).toHaveLength(1)
    expect(game.read().won).toBe(true)
  })
})
