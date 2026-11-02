import {createHash} from 'node:crypto'
import {offlineGameRuntimeSource} from './export-game'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {playtestTraceRules,offlinePlaytestTraceSource} from './playtest-trace'
import {bootOfflineMap} from './test-support/offline-map'
import type {AuthoredLevelMap,BehaviorStage,GameSpec} from '@/types'

afterEach(()=>vi.unstubAllGlobals())
describe('bounded playtest traces',()=>{
  it('separates retry time origins, bounds samples/events and reports dropped records',()=>{
    const trace=playtestTraceRules.fresh('key','online'),point={levelId:'level-1',sim:0,x:1,y:2}
    playtestTraceRules.begin(trace,{...point,kind:'level-start'})
    for(let i=0;i<4000;i++)playtestTraceRules.sample(trace,{...point,sim:i*100,vx:0,vy:1,onGround:false,health:10})
    expect(trace.samples).toHaveLength(3600);expect(trace.droppedSamples).toBe(400)
    playtestTraceRules.begin(trace,{...point,kind:'retry'});playtestTraceRules.sample(trace,{...point,vx:0,vy:0,onGround:true,health:10})
    expect(trace.samples.at(-1)).toMatchObject({segment:2,sim:0})
    for(let i=0;i<2100;i++)playtestTraceRules.event(trace,{...point,kind:'jump'})
    expect(trace.events).toHaveLength(2048);expect(trace.droppedEvents).toBeGreaterThan(0)
    expect(playtestTraceRules.restore('wrong','online',trace).samples).toEqual([])
    const bad=structuredClone(trace);bad.samples[0].x=NaN;expect(playtestTraceRules.restore('key','online',bad).samples).toEqual([])
  })
  it('uses identical recorder rules online and in exported games and returns independent restored arrays',()=>{
    const offline=new Function(offlinePlaytestTraceSource()+';return playtestTraceRules')() as typeof playtestTraceRules
    const a=playtestTraceRules.fresh('same','offline'),b=offline.fresh('same','offline'),point={levelId:'L1',sim:0,x:20,y:30}
    playtestTraceRules.begin(a,{...point,kind:'restore'});offline.begin(b,{...point,kind:'restore'})
    for(const sim of [0,20,100,200]){const p={...point,sim,vx:2,vy:-3,onGround:false,health:100};playtestTraceRules.sample(a,p);offline.sample(b,p)}
    expect(a).toEqual(b);const restored=offline.restore('same','offline',b);restored.events[0].x=99;expect(b.events[0].x).toBe(20)
  })
  it('records actual jump/death/checkpoint/retry and program stages, pauses sampling and restores saved observations',async()=>{
    const map:AuthoredLevelMap={version:2,width:1600,height:720,groundY:400,player:{x:80,y:336,width:32,height:64},exit:{x:1400,y:304,width:64,height:96},obstacles:[],enemies:[],collectibles:[],boss:{id:'boss',kind:'boss',x:550,y:336,width:64,height:64},checkpoints:[{id:'cp',x:70,y:0,width:80,height:400,respawn:{x:300,y:336}}],mechanisms:[{id:'trap',kind:'trap',x:70,y:0,width:80,height:400,delayMs:100,durationMs:100,cooldownMs:100}]}
    const first:BehaviorStage={id:'warn',label:'Warning',triggerDistance:0,triggerAbove:false,warningMs:50,activeMs:100,cooldownMs:50,repeats:1,motion:'still',dx:0,dy:0,speed:0,leash:0,attack:'none',attackEveryMs:100,vulnerable:true,transition:'time',healthBelow:0.5}
    const configure=(s:GameSpec)=>{s.boss.program={version:1,onDefeat:'remove',loop:false,stages:[first,{...first,id:'second',label:'Second',warningMs:0,activeMs:5000}]};s.levels[0].hasBoss=true}
    const game=await bootOfflineMap(map,undefined,configure);game.key('w');game.tick(60)
    const trace=game.read().trace,kinds=new Set(trace.events.map(e=>e.kind))
    for(const kind of ['jump','death','checkpoint','retry','boss-stage'])expect(kinds.has(kind as never)).toBe(true)
    expect(trace.samples.some(s=>s.y<336)).toBe(true)
    expect(trace.events.some(e=>e.kind==='boss-stage'&&e.stage===1)).toBe(true)
    const count=trace.samples.length;game.pause();game.tick(40);expect(game.read().trace.samples).toHaveLength(count)
    game.pause();const saved=game.saveAll(),loaded=await bootOfflineMap(map,saved,configure)
    expect(loaded.read().trace.events.some(e=>e.kind==='death')).toBe(true)
    expect(loaded.read().trace.events.at(-1)?.kind).toBe('restore')
    expect(loaded.read().trace.segment).toBe(trace.segment+1)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'proof-'+createHash('sha256').update(offlineGameRuntimeSource()).digest('hex').slice(0,12));await mkdir(dir,{recursive:true});await writeFile(join(dir,'实际离线引擎轨迹.json'),JSON.stringify(loaded.read().trace,null,2)+'\n')}
  })
})
