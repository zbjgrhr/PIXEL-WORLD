import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ensureEncounterClearance } from './encounter-layout'
import { createFallbackGameSpec } from './game-spec'
import { offlineGameRuntimeSource } from './export-game'
import { narrativeEngine } from './narrative-runtime'
import { buildGameDataFromSpec } from './virtual-levels'
import { migrateGameData } from './store'
import type { LevelData } from '@/types'

function oldLayout(): LevelData {
  return { id: 'level-1', backgroundUrl: '', obstacles: [190,390,810].map((x,index) => ({ id: `block-${index}`, x, y:390, width:48, height:48, type:['normalObstacle','bounceObstacle','deathObstacle'][index] })),
    enemySpawns: [270,450,630].map((x,index) => ({ id:`level-1-enemy-${index+1}`,x,y:384,kind:'groundEnemy' })), collectibleSpawns: [],
  }
}
describe('clear encounter lanes for generated and cached layouts', () => {
  it('removes the reported 12px choke while preserving identities, counts and terrain size', () => {
    const old = oldLayout(), before = structuredClone(old)
    expect(old.enemySpawns[1].x - (old.obstacles[1].x + old.obstacles[1].width)).toBe(12)
    const safe = ensureEncounterClearance(old)
    expect(old).toEqual(before)
    expect(safe.obstacles.map(item => [item.id,item.type,item.width,item.height])).toEqual(old.obstacles.map(item => [item.id,item.type,item.width,item.height]))
    expect(safe.enemySpawns.map(item => item.id)).toEqual(old.enemySpawns.map(item => item.id))
    const combatEdge = Math.max(...safe.enemySpawns.map(spawn => spawn.patrolMax! + 52))
    expect(safe.obstacles[0].x).toBe(190)
    expect(safe.enemySpawns.every(spawn => spawn.patrolMin! >= 190 + 48 + 70)).toBe(true)
    expect(safe.obstacles.slice(1).every(obstacle => obstacle.x >= combatEdge + 70)).toBe(true)
    expect(safe.obstacles.some(obstacle => obstacle.x === 390)).toBe(false)
    expect(safe.worldWidth).toBeGreaterThanOrEqual(Math.max(...safe.obstacles.map(item => item.x+item.width)) + 230)
    expect(ensureEncounterClearance(safe)).toBe(safe)
  })
  it('keeps obstacles after the whole Boss patrol and expands the world instead of squeezing them together', () => {
    const old = oldLayout()
    old.bossSpawn = { id:'boss',x:780,y:310,kind:'boss' }
    const safe = ensureEncounterClearance(old)
    expect(safe.bossSpawn).toEqual(old.bossSpawn)
    expect(safe.obstacles.slice(1).every(obstacle => obstacle.x >= 780+180+100+70)).toBe(true)
    expect(safe.worldWidth).toBeGreaterThan(1152)
    for(let index=2;index<safe.obstacles.length;index++) expect(safe.obstacles[index].x - (safe.obstacles[index-1].x+safe.obstacles[index-1].width)).toBeGreaterThanOrEqual(92)
  })
  it('does not force a new starting obstacle into layouts that did not contain one', () => {
    const old=oldLayout(); old.obstacles=old.obstacles.slice(1)
    const safe=ensureEncounterClearance(old)
    expect(safe.obstacles.every(item=>item.x>630)).toBe(true)
    expect(safe.collectibleSpawns).toEqual(old.collectibleSpawns)
  })
  it('includes fallback enemies in the clear lane instead of adding them behind unplanned walls', () => {
    const old=oldLayout(); old.enemySpawns=[]
    const safe=ensureEncounterClearance(old,5)
    expect(safe.enemySpawns).toHaveLength(5)
    expect(safe.obstacles.slice(1).every(obstacle=>obstacle.x>=Math.max(...safe.enemySpawns.map(spawn=>spawn.patrolMax!+52))+70)).toBe(true)
  })
  it('preserves the layout version and world extent through the actual cached-game migration', () => {
    const spec=createFallbackGameSpec('A penguin searches for its mother.','Migration fixture',3,'en')
    spec.assets=spec.assets.map(asset=>['normalObstacle','bounceObstacle','deathObstacle'].includes(asset.category)?{...asset,enabled:true,url:'data:image/png;base64,fixture'}:asset)
    const generated=buildGameDataFromSpec(spec), restored=migrateGameData(generated,'migration-fixture')
    expect(restored.data!.levels).toEqual(generated.data!.levels)
    for(const level of restored.data!.levels)expect(ensureEncounterClearance(level)).toBe(level)
  })
})

it.each([false,true])('runs the real offline movement/camera and preserves saved state (restore=%s)', async restore => {
  const spec=createFallbackGameSpec('A penguin searches for its mother.','Collision fixture',1,'en')
  spec.assets=[]; spec.narrative=undefined
  const layout=ensureEncounterClearance({ ...oldLayout(), id:spec.levels[0].id })
  const saved = { key:narrativeEngine.key(spec),level:0,levelScore:0,score:123,sim:0,
    player:{x:130,y:491,vx:0,vy:0,w:54,h:64,hp:37,face:1,on:true,invulnerable:0,meleeReady:0,rangedReady:0,action:'idle',actionStart:0,actionUntil:0},
    enemies:[{uid:layout.enemySpawns[0].id,x:170,y:501,w:52,h:54,hp:55,mobility:'ground',face:1,phase:0,vy:0,on:true,patrolMin:170,patrolMax:370,lastAttack:0,nextJump:1500,removeAt:0,action:'idle',actionUntil:0,actionStart:0}],items:[],story:narrativeEngine.fresh(spec),unread:[],
  }
  let frame:(time:number)=>void=()=>{}, snapshot:()=>any=()=>null
  const listeners=new Map<string,(event:any)=>void>(), translations:number[]=[]
  const node=()=>({style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},replaceChildren(){}})
  const nodes=new Map<string,ReturnType<typeof node>>()
  const context=new Proxy({}, { get:(_target,key)=>key==='translate'?(x:number)=>translations.push(x):()=>{} })
  const sandbox:any={ document:{
    getElementById:(id:string)=>({textContent:JSON.stringify(id==='project-data'?spec:{levels:[layout]})}),
    querySelector:(selector:string)=>{if(selector==='canvas')return{getContext:()=>context};if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector)},
    querySelectorAll:()=>[],createElement:node,body:node(),addEventListener(){},
  },performance:{now:()=>0},requestAnimationFrame:(callback:typeof frame)=>{frame=callback},setInterval(){},addEventListener:(name:string,callback:(event:any)=>void)=>listeners.set(name,callback),localStorage:{getItem:()=>restore?JSON.stringify(saved):null,setItem(){},removeItem(){}},Image:class{}, }
  runInNewContext(offlineGameRuntimeSource(),sandbox)
  await new Promise(resolve=>setImmediate(resolve))
  snapshot=sandbox.__pixelWorldReadOnlySnapshot
  expect(snapshot().layoutVersion).toBe(2)
  expect(snapshot().worldWidth).toBe(layout.worldWidth)
  expect(snapshot().obstacles.some((item:any)=>item.x===390)).toBe(false)
  if(restore){
    expect(snapshot().player.hp).toBe(37);expect(snapshot().score).toBe(123)
    expect(snapshot().enemies).toHaveLength(1)
    expect(snapshot().enemies[0].hp).toBe(55)
    expect(snapshot().enemies[0].patrolMin).toBe(layout.enemySpawns[0].patrolMin)
    expect(snapshot().enemies[0].x).toBeGreaterThanOrEqual(layout.enemySpawns[0].patrolMin!)
  }
  for(const key of ['w','d']) listeners.get('keydown')!({key,repeat:false,preventDefault(){}})
  for(let index=1;index<=150;index++)frame(index*16.67)
  expect(snapshot().player.hp).toBeGreaterThan(0)
  expect(snapshot().player.x).toBeGreaterThan(440)
  expect(translations.some(x=>x<0)).toBe(true)
})
