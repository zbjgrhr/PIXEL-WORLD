import {afterEach,describe,expect,it,vi} from 'vitest'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {applyOriginalMappings,type OriginalMapping} from './batch-original-import'
import {originalArtRules,offlineOriginalArtSource} from './original-art'
import {normalizeAnimationSpec,replaceAnimationClip} from './asset-catalog'
import {withUploadedStatic} from './uploaded-asset'
import {createFallbackGameSpec,normalizeGameSpec} from './game-spec'
import {stripLargeAssetUrls,hydrateSpecAssetsWithUrls} from './asset-db'
import {exportGameZip,offlineGameRuntimeSource} from './export-game'
import {readStoredGameArchive} from './community-play-archive'
import type {OriginalImageSpec} from '@/types'
import {bootOfflineMap} from './test-support/offline-map'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
const meta:OriginalImageSpec={version:1,fileName:'original-strip.png',sha256:'a'.repeat(64),width:128,height:16,bytes:64}
const entry=(assetId:string,patch:Partial<OriginalMapping>={}):OriginalMapping=>({assetId,pose:'walk',url:'data:image/png;base64,AAAA',original:meta,frameCount:8,fps:20,loop:true,frameOrder:[7,0,3,3],...patch})
describe('original image import',()=>{
  it('applies mappings atomically, keeps original metadata and rejects duplicate or mixed targets',()=>{
    const spec=createFallbackGameSpec('Source','Source',1),hero=spec.assets.find(a=>a.category==='hero')!
    const next=applyOriginalMappings(spec,[entry(hero.id)])
    expect(next.assets.find(a=>a.id===hero.id)?.animation?.clips?.walk).toMatchObject({frameCount:8,fps:20,loop:true,frameOrder:[7,0,3,3],original:meta})
    expect(spec.assets.find(a=>a.id===hero.id)?.animation?.clips?.walk?.original).toBeUndefined()
    expect(()=>applyOriginalMappings(spec,[entry(hero.id),entry(hero.id)])).toThrow('duplicate')
    expect(()=>applyOriginalMappings(spec,[entry(hero.id),entry(hero.id,{pose:undefined})])).toThrow('mix')
    expect(()=>applyOriginalMappings(spec,[entry(hero.id,{frameOrder:[8]})])).toThrow('indices')
    expect(()=>applyOriginalMappings(spec,[entry('missing')])).toThrow('Choose')
  })
  it('keeps long, narrow original strips and custom frame timing while legacy generated clips keep their limits',()=>{
    const clip=entry('hero'),animation=normalizeAnimationSpec({layoutVersion:3,clips:{walk:{...clip,enabled:true,status:'success'}}})
    expect(animation.clips!.walk).toMatchObject({frameCount:8,fps:20,frameOrder:[7,0,3,3],original:meta})
    expect(normalizeAnimationSpec({layoutVersion:3,clips:{walk:{frameCount:8,fps:60}}}).clips!.walk).toMatchObject({frameCount:3,fps:12})
    const offline=new Function(offlineOriginalArtSource()+';return originalArtRules')() as typeof originalArtRules
    for(const elapsed of [0,50,100,150,200,350])expect(offline.frame(animation.clips!.walk!,elapsed)).toBe(originalArtRules.frame(animation.clips!.walk!,elapsed))
    expect([0,50,100,150,200].map(t=>originalArtRules.frame(animation.clips!.walk!,t))).toEqual([7,0,3,3,7])
    expect(originalArtRules.geometry(128,16,8)).toBe(true)
  })
  it('uses content-addressed cache keys and preserves static and clip data on hydration and model normalization',()=>{
    const spec=createFallbackGameSpec('Source','Source',1),hero=spec.assets.find(a=>a.category==='hero')!,bg=spec.assets.find(a=>a.category==='levelBackground')!
    const imported=applyOriginalMappings(spec,[entry(hero.id),entry(bg.id,{pose:undefined})]),stored=stripLargeAssetUrls(imported)
    const heroKey=hero.id+':clip:walk:original:'+meta.sha256,bgKey=bg.id+':original:'+meta.sha256
    expect(stored.assets.find(a=>a.id===hero.id)?.animation?.clips?.walk?.url).toBe('cached-image:'+heroKey)
    expect(stored.assets.find(a=>a.id===bg.id)?.url).toBe('cached-image:'+bgKey)
    const hydrated=hydrateSpecAssetsWithUrls(stored,{[heroKey]:entry(hero.id).url,[bgKey]:entry(bg.id).url})
    expect(hydrated.assets.find(a=>a.id===bg.id)?.url).toBe(entry(bg.id).url)
    expect(hydrated.assets.find(a=>a.id===hero.id)?.animation?.clips?.walk?.frameOrder).toEqual([7,0,3,3])
    const proposed=structuredClone(hydrated);const changed=proposed.assets.find(a=>a.id===hero.id)!;changed.animation!.clips!.walk!.frameCount=1
    expect(normalizeGameSpec(proposed,hydrated).assets.find(a=>a.id===hero.id)?.animation?.clips?.walk?.frameCount).toBe(8)
  })
  it('exports the exact PNG bytes, not a rescaled or re-encoded version',async()=>{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','base64'),original:OriginalImageSpec={version:1,fileName:'source.png',sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),bytes:bytes.length}
    const base=createFallbackGameSpec('Original art proof','Original art proof',1);base.assets=base.assets.map(a=>({...a,enabled:false,url:undefined}))
    const bg=base.assets.find(a=>a.category==='levelBackground')!,spec=applyOriginalMappings(base,[entry(bg.id,{pose:undefined,url:'data:image/png;base64,'+bytes.toString('base64'),original})])
    let saved:Blob|undefined
    vi.spyOn(URL,'createObjectURL').mockImplementation(b=>{saved=b as Blob;return 'blob:test-original'})
    vi.stubGlobal('document',{createElement:()=>({click:vi.fn()})});vi.stubGlobal('window',{setTimeout:vi.fn()})
    await exportGameZip(spec)
    const files=readStoredGameArchive((await saved!.arrayBuffer())),project=JSON.parse(new TextDecoder().decode(files.find(f=>f.name==='project.json')!.bytes)),asset=project.assets.find((a:{id:string})=>a.id===bg.id)
    const exported=files.find(f=>f.name===asset.url)!.bytes
    expect(createHash('sha256').update(exported).digest('hex')).toBe(original.sha256)
    expect(Buffer.from(exported)).toEqual(bytes)
    expect(asset.original).toEqual(original)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'proof-'+createHash('sha256').update(offlineGameRuntimeSource()).digest('hex').slice(0,12));await mkdir(dir,{recursive:true});await writeFile(join(dir,'原图字节验证包.zip'),new Uint8Array(await saved!.arrayBuffer()));await writeFile(join(dir,'原图字节验证GameSpec.json'),JSON.stringify(project,null,2)+'\n');await writeFile(join(dir,'原始图片.png'),bytes);await writeFile(join(dir,'原图校验.json'),JSON.stringify({sourceSha256:original.sha256,exportedSha256:createHash('sha256').update(exported).digest('hex'),sameBytes:true,note:'Byte-preservation fixture, not original-game fidelity or playthrough evidence.'},null,2)+'\n')}
  })
  it('actually renders custom idle frame order in the exported engine without the generated-art alpha guard',async()=>{
    vi.stubGlobal('Image',class{width=128;height=16;onload?:()=>void;set src(_value:string){this.onload?.()}})
    const game=await bootOfflineMap({version:2,width:1600,height:720,groundY:400,player:{x:80,y:336,width:32,height:64},exit:{x:1400,y:304,width:64,height:96},obstacles:[],enemies:[],collectibles:[]},undefined,s=>{
      const hero=s.assets.find(a=>a.category==='hero')!,next=applyOriginalMappings(s,[entry(hero.id,{pose:'idle'})]);s.assets=next.assets
    })
    game.tick();expect(game.draws.at(-1)?.[1]).toBe(112)
    game.tick(3);expect(game.draws.at(-1)?.[1]).toBe(0)
  })
  it('does not attribute an explicit replacement to the previous original file',()=>{
    const s=createFallbackGameSpec('Original','Original',1),hero=s.assets.find(a=>a.category==='hero')!,next=applyOriginalMappings(s,[entry(hero.id,{pose:'idle'})]).assets.find(a=>a.id===hero.id)!
    expect(next.original?.sha256).toBe(meta.sha256)
    expect(withUploadedStatic(next,'data:image/png;base64,BBBB').original).toBeUndefined()
    const replaced=replaceAnimationClip(next,'idle',{frameCount:1,fps:1,loop:false,enabled:true,status:'success',url:'data:image/png;base64,BBBB'})
    expect(replaced.original).toBeUndefined();expect(replaced.animation?.clips?.idle?.original).toBeUndefined()
  })
})
