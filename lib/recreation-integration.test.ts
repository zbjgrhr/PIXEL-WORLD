import {afterEach,describe,it,expect,vi} from 'vitest'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {exportGameZip} from './export-game'
import {readEditableProject} from './editable-project'
import {readTraceJSON,compareTraceRuns} from './trace-review'
import {inspectGameSpec,inspectVisualAssets,inspectPlayability} from './agents/validation'
import {recreationAcceptanceSpec} from './test-support/recreation-acceptance'
import {bootOfflineMap} from './test-support/offline-map'
import {playtestTraceRules} from './playtest-trace'
import {referenceFingerprint} from './reference-analysis'
import {normalizeGameSpec} from './game-spec'
import {migrateGameData} from './store'
import {buildGameDataFromSpec} from './virtual-levels'
import {normalizeArtifact} from './agents/execution'
import type {AgentExecuteRequest,GameSpec} from '@/types'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
async function exported(spec:Awaited<ReturnType<typeof recreationAcceptanceSpec>>){let saved:Blob|undefined;vi.spyOn(URL,'createObjectURL').mockImplementation(v=>{saved=v as Blob;return 'blob:acceptance'});vi.stubGlobal('document',{createElement:()=>({click:vi.fn()})});vi.stubGlobal('window',{setTimeout:vi.fn()});await exportGameZip(spec);return saved!.arrayBuffer()}
describe('integrated recreation workflow',()=>{
  it('passes planning, visual and playability checks with original frames and reopens the actual exported project without changing rules or art',async()=>{
    const spec=await recreationAcceptanceSpec();expect(inspectGameSpec(spec).filter(i=>i.severity==='blocking')).toEqual([]);expect(inspectVisualAssets(spec)).toEqual([]);expect(inspectPlayability(spec).filter(i=>i.severity==='blocking')).toEqual([])
    const stored=migrateGameData(buildGameDataFromSpec(spec)).data!.spec!
    expect(stored.boss.health).toBe(spec.boss.health);expect(stored.boss.damage).toBe(spec.boss.damage);expect(stored.boss.speed).toBe(spec.boss.speed);expect(stored.hero.physics).toEqual(spec.hero.physics);expect(stored.hero.roster).toEqual(spec.hero.roster)
    const buffer=await exported(stored),restored=await readEditableProject(buffer)
    expect(restored.levels).toEqual(spec.levels);expect(restored.hero).toEqual(spec.hero);expect(restored.boss.program).toEqual(spec.boss.program);expect(restored.reference).toMatchObject({title:spec.reference!.title})
    for(const asset of spec.assets.filter(a=>a.enabled))expect(restored.assets.find(a=>a.id===asset.id)?.url).toBe(asset.url)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'unified-project');await mkdir(dir,{recursive:true});await writeFile(join(dir,'八项联合验收项目.zip'),new Uint8Array(buffer));await writeFile(join(dir,'可编辑GameSpec.json'),JSON.stringify(restored,null,2)+'\n')}
  })
  it('keeps exact authored actor parameters through Agent normalization rather than applying template balance clamps',async()=>{
    const spec=await recreationAcceptanceSpec();spec.hero.maxHealth=1;spec.hero.moveSpeed=1;spec.hero.jumpPower=5;spec.weapon.rangedDamage=2;spec.enemies[0].health=2;spec.enemies[0].speed=0
    const proposal=structuredClone(spec);proposal.boss.health=900;proposal.hero.moveSpeed=9;proposal.weapon.rangedDamage=90
    const normalized=normalizeGameSpec(proposal,spec)
    expect(normalized.hero.maxHealth).toBe(1);expect(normalized.hero.moveSpeed).toBe(1);expect(normalized.hero.jumpPower).toBe(5);expect(normalized.boss.health).toBe(30);expect(normalized.boss.damage).toBe(1);expect(normalized.boss.speed).toBe(0);expect(normalized.weapon.rangedDamage).toBe(2);expect(normalized.enemies[0].health).toBe(2);expect(normalized.enemies[0].speed).toBe(0)
  })
  it('preserves the authored contract through the server Agent artifact path',async()=>{
    const spec=await recreationAcceptanceSpec(),request:AgentExecuteRequest={runId:'source-contract',taskId:'integrator-r1',role:'integrator',round:1,provider:'openrouter',model:'test-model',apiKey:'',projectName:spec.title,sourcePrompt:spec.backgroundStory,levelCount:1,baseSpec:spec,artifacts:{}}
    const result=normalizeArtifact(request,{artifact:{spec:{title:spec.title}}}).artifact.spec as GameSpec
    expect(result.boss.health).toBe(30);expect(result.boss.speed).toBe(0);expect(result.boss.program).toEqual(spec.boss.program);expect(result.levels[0].map).toEqual(spec.levels[0].map);expect(result.hero.roster).toEqual(spec.hero.roster)
  })
  it('allows an explicit source map with no final Boss while preserving the automatic-template Boss rule',async()=>{
    const spec=await recreationAcceptanceSpec();delete spec.levels[0].map!.boss;spec.levels[0].hasBoss=false;spec.assets=spec.assets.filter(a=>a.category!=='boss')
    expect(inspectPlayability(spec).filter(i=>i.severity==='blocking')).toEqual([])
    delete spec.levels[0].map;expect(inspectGameSpec(spec).some(i=>i.path==='levels.last.hasBoss')).toBe(true)
  })
  it('keeps original animation strips longer than three frames eligible for visual review',async()=>{
    const spec=await recreationAcceptanceSpec(),hero=spec.assets.find(a=>a.category==='hero')!
    hero.kind='spriteSheet';hero.animation={layoutVersion:3,format:'action-strips',columns:3,rows:1,fps:5,states:{idle:0,walk:0,jump:0,attack:0,meleeAttack:0,rangedAttack:0,hit:0,death:0},clips:{idle:{frameCount:8,fps:20,loop:true,enabled:true,status:'success',url:'data:image/png;base64,AAAA',original:{version:1,fileName:'eight.png',width:128,height:16,bytes:3,sha256:'c'.repeat(64)}}}}
    expect(inspectVisualAssets(spec).filter(i=>i.path.includes(hero.id)&&i.path.includes('idle'))).toEqual([])
  })
  it('removes imported comparison confirmations and rejects broken packages before applying a draft',async()=>{
    const spec=await recreationAcceptanceSpec();spec.reference!.requirements[0].policy='required';spec.reference!.requirements[0].confirmed=true;spec.reference!.requirements[0].confirmationKey=referenceFingerprint(spec)
    const buffer=await exported(spec),restored=await readEditableProject(buffer);expect(restored.reference!.requirements[0].confirmed).toBe(false);expect(inspectGameSpec(restored).some(i=>i.path==='reference.controls')).toBe(true)
    const broken=buffer.slice(0);new Uint8Array(broken)[50]^=1;await expect(readEditableProject(broken)).rejects.toThrow()
  })
  it('runs the combined authored rules through checkpoint death, respawn, character selection, six stages, pause and saved-session restore',async()=>{
    vi.stubGlobal('Image',class{width=64;height=64;onload?:()=>void;set src(_value:string){this.onload?.()}})
    const spec=await recreationAcceptanceSpec(),map=spec.levels[0].map!,game=await bootOfflineMap(map,undefined,s=>Object.assign(s,spec))
    game.tick(100);expect(game.read().mechanismState.checkpointId).toBe('save-1');expect(new Set(game.read().trace.events.filter(e=>e.kind==='boss-stage').map(e=>e.stage)).size).toBe(6)
    game.key('c');game.tick();game.key('c',false);expect(game.read().rosterState?.characterId).toBe('ball')
    game.key('d');for(let i=0;i<300&&!game.read().trace.events.some(e=>e.kind==='death');i++)game.tick();game.key('d',false);expect(game.read().trace.events.some(e=>e.kind==='death')).toBe(true)
    game.tick(60);expect(game.read().player.hp).toBeGreaterThan(0);expect(game.read().mechanismState.checkpointId).toBe('save-1')
    const saved=game.saveAll(),snapshot=game.read();game.pause();game.tick(40);expect(game.read().sim).toBe(snapshot.sim)
    const restored=await bootOfflineMap(map,saved,s=>Object.assign(s,spec));restored.tick();expect(restored.read().rosterState).toEqual(snapshot.rosterState);expect(restored.read().mechanismState.checkpointId).toBe('save-1')
    const trace=readTraceJSON(JSON.stringify(restored.read().trace));expect(trace.events.some(e=>e.kind==='restore')).toBe(true)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'unified-project');await mkdir(dir,{recursive:true});await writeFile(join(dir,'离线联合运行轨迹.json'),JSON.stringify(trace,null,2)+'\n')}
  })
  it('compares level segments by relative time and rejects invalid or mismatched rule identities',()=>{
    const a=playtestTraceRules.fresh('same','online'),b=playtestTraceRules.fresh('same','offline'),point={levelId:'level-1',sim:0,x:0,y:0,vx:1,vy:0,onGround:true,health:10}
    for(let i=0;i<4;i++){playtestTraceRules.sample(a,{...point,sim:i*100,x:i*10});playtestTraceRules.sample(b,{...point,sim:500+i*100,x:i*10+3,y:4})}
    expect(compareTraceRuns(readTraceJSON(JSON.stringify(a)),b,'level-1',0,0)).toMatchObject({compatible:true,matchedSamples:4,meanDistance:5,maxDistance:5})
    expect(compareTraceRuns(a,{...b,storyKey:'other'},'level-1',0,0).compatible).toBe(false)
    expect(()=>readTraceJSON(JSON.stringify({...a,samples:[{...a.samples[0],x:null}]}))).toThrow()
  })
  it('completes the combined map using movement, jumping over the trap and ranged combat in the real offline engine',async()=>{
    vi.stubGlobal('Image',class{width=64;height=64;onload?:()=>void;set src(_value:string){this.onload?.()}})
    const spec=await recreationAcceptanceSpec(),game=await bootOfflineMap(spec.levels[0].map!,undefined,s=>Object.assign(s,spec));game.tick(100);game.key('d')
    let jumped=false
    for(let i=0;i<650&&!game.read().won;i++){
      const state=game.read()
      if(!jumped&&state.player.x>=400){game.key(' ');game.tick(20);game.key(' ',false);jumped=true}
      if(i%30===0){game.key('k');game.key('k',false)}
      game.tick()
    }
    const final=game.read()
    expect(final.won,JSON.stringify({player:final.player,enemies:final.enemies,events:final.trace.events.slice(-4)})).toBe(true);expect(final.trace.events.some(e=>e.kind==='jump')).toBe(true)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'unified-project');await mkdir(dir,{recursive:true});await writeFile(join(dir,'离线实际引擎通关轨迹.json'),JSON.stringify(game.read().trace,null,2)+'\n');await writeFile(join(dir,'离线通关结论.json'),JSON.stringify({won:game.read().won,simulationTime:game.read().sim,score:game.read().score,note:'Automated real offline-engine input run, not a human original-game fidelity acceptance.'},null,2)+'\n')}
  })
})
