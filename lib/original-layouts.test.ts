import {afterEach,describe,it,expect,vi} from 'vitest'
import {createHash} from 'node:crypto'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createFallbackGameSpec} from './game-spec'
import {applyOriginalMappings,buildOriginalPreview,type OriginalMapping} from './batch-original-import'
import {originalArtRules} from './original-art'
import {stripLargeAssetUrls,hydrateSpecAssetsWithUrls,assetMetadataForReview} from './asset-db'
import {exportGameZip,offlineGameRuntimeSource} from './export-game'
import {readStoredGameArchive} from './community-play-archive'
import {buildGamePreviewDocument} from './community-play-document'
import {bootOfflineMap} from './test-support/offline-map'
import {convertGameMakerRoom} from './gamemaker-map'
import {buildGameDataFromSpec} from './virtual-levels'
import type {AuthoredLevelMap} from '@/types'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
const fixture=(assetId:string,patch:Partial<OriginalMapping>={}):OriginalMapping=>({assetId,pose:'idle',layout:'grid',columns:2,rows:2,frameCount:4,fps:10,loop:true,frameOrder:[2,1,3],url:'data:image/png;base64,AAAA',original:{version:1,fileName:'atlas.png',width:64,height:32,bytes:100,sha256:'a'.repeat(64)},...patch})
const flatMap=():AuthoredLevelMap=>({version:2,width:1600,height:720,groundY:400,player:{x:80,y:336,width:32,height:64},exit:{x:1400,y:304,width:64,height:96},obstacles:[],enemies:[],collectibles:[]})
describe('original atlas and individual-frame layouts',()=>{
  it('previews complete sequences before applying, including file order, repeated playback and nonlooping end frames',()=>{
    const spec=createFallbackGameSpec('Preview','Preview',1),id=spec.assets.find(a=>a.category==='hero')!.id
    const a=fixture(id,{layout:'sequence',sequenceIndex:4,fps:10,loop:false,frameOrder:[1,0,1]}),b=fixture(id,{layout:'sequence',sequenceIndex:2,fps:10,loop:false,frameOrder:[1,0,1],url:'data:image/png;base64,BBBB',original:{...a.original,fileName:'second.png',width:32,height:64,sha256:'b'.repeat(64)}})
    const clip=buildOriginalPreview(spec,[a,b],1)!
    expect([0,100,200,900].map(t=>originalArtRules.at(clip,originalArtRules.frame(clip,t)).url)).toEqual([a.url,b.url,a.url,a.url])
    expect(originalArtRules.at(clip,0).rect).toMatchObject({width:32,height:64})
    expect(buildOriginalPreview(spec,[a,b],0)).toEqual(clip)
    expect(spec.assets.find(a=>a.id===id)!.animation?.clips?.idle?.original).toBeUndefined()
    expect(()=>buildOriginalPreview(spec,[a,{...b,fps:20}],0)).toThrow('matching')
  })
  it('previews grid crops with the same configuration validation as apply and keeps unmapped files viewable',()=>{
    const spec=createFallbackGameSpec('Preview','Preview',1),id=spec.assets.find(a=>a.category==='hero')!.id
    const clip=buildOriginalPreview(spec,[fixture(id)],0)!
    expect(originalArtRules.at(clip,originalArtRules.frame(clip,0)).rect).toMatchObject({x:0,y:16,width:32,height:16})
    expect(()=>buildOriginalPreview(spec,[fixture(id,{columns:3})],0)).toThrow('grid')
    expect(buildOriginalPreview(spec,[fixture('')],0)?.frameCount).toBe(1)
    expect(buildOriginalPreview(spec,[],0)).toBeUndefined()
  })
  it('preserves supplied real character frames byte for byte together with converted room geometry',async()=>{
    const root=process.env.PIXEL_WORLD_GAMEMAKER_ROOT,reference=process.env.PIXEL_WORLD_GAMEMAKER_REFERENCE
    if(!root||!reference)return
    const ref=JSON.parse(await readFile(reference,'utf8')),sprite=ref.sprites.find((s:{id:string})=>s.id==='spr_charReg_walk')
    expect(sprite.frameIds).toHaveLength(3)
    const spec=createFallbackGameSpec('Source frame preservation check','Source frame preservation check',1)
    spec.assets=spec.assets.map(a=>({...a,enabled:false,url:undefined,animation:undefined,kind:a.category==='hero'?'image':a.kind}))
    const id=spec.assets.find(a=>a.category==='hero')!.id,sharp=(await import('sharp')).default
    const originals=await Promise.all(sprite.frameIds.map(async(frame:string,index:number)=>{
      if(!/^[a-f0-9-]+$/.test(frame))throw Error('Unsafe frame name')
      const bytes=await readFile(join(root,'sprites','spr_charReg_walk',frame+'.png')),metadata=await sharp(bytes).metadata()
      expect(metadata.width).toBe(sprite.width);expect(metadata.height).toBe(sprite.height)
      return {bytes,mapping:fixture(id,{layout:'sequence',sequenceIndex:index,frameCount:1,frameOrder:[0,1,2],url:'data:image/png;base64,'+bytes.toString('base64'),original:{version:1,fileName:frame+'.png',width:metadata.width!,height:metadata.height!,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})}
    }))
    const next=applyOriginalMappings(spec,originals.map(o=>o.mapping)),converted=convertGameMakerRoom(ref.rooms.find((r:{id:string})=>r.id==='tutorial'),{layerNames:['Tiles_1'],player:{x:60,y:352,width:32,height:64},exit:{x:1000,y:320,width:48,height:96}})
    next.narrative=undefined
    next.levels[0]={...next.levels[0],map:converted.map,enemyCount:0,collectibleCount:0,hasBoss:false}
    expect(buildGameDataFromSpec(next).data!.levels[0].authoredMap).toEqual(converted.map)
    let saved:Blob|undefined
    vi.spyOn(URL,'createObjectURL').mockImplementation(v=>{saved=v as Blob;return 'blob:real-frames'})
    vi.stubGlobal('document',{createElement:()=>({click:vi.fn()})});vi.stubGlobal('window',{setTimeout:vi.fn()})
    await exportGameZip(next)
    const files=readStoredGameArchive(await saved!.arrayBuffer()),projectFile=files.find(f=>f.name==='project.json')!,project=JSON.parse(new TextDecoder().decode(projectFile.bytes)),clip=project.assets.find((a:{id:string})=>a.id===id).animation.clips.idle
    for(let i=0;i<originals.length;i++){const target=i?clip.originalPages[i].url:clip.url;expect(Buffer.from(files.find(f=>f.name===target)!.bytes)).toEqual(originals[i].bytes)}
    expect(project.levels[0].map).toEqual(converted.map)
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'real-source-frames-v2');await mkdir(dir,{recursive:true});await writeFile(join(dir,'原作散帧与碰撞保留检查.zip'),new Uint8Array(await saved!.arrayBuffer()));await writeFile(join(dir,'GameSpec.json'),projectFile.bytes);await writeFile(join(dir,'原图字节核对.json'),JSON.stringify({sprite:sprite.id,frames:originals.map(o=>o.mapping.original),note:'Raw source walk frames mapped to idle only to check packaging. Explicit test anchors and converted collision only; not original gameplay or a faithful reconstruction.'},null,2)+'\n')}
  })
  it('maps row-major atlas rectangles, rejects invalid grids and out-of-bounds frame data',()=>{
    const spec=createFallbackGameSpec('Atlas','Atlas',1),id=spec.assets.find(a=>a.category==='hero')!.id
    const next=applyOriginalMappings(spec,[fixture(id)]),clip=next.assets.find(a=>a.id===id)!.animation!.clips!.idle!
    expect(clip.frameRects).toEqual([{page:0,x:0,y:0,width:32,height:16},{page:0,x:32,y:0,width:32,height:16},{page:0,x:0,y:16,width:32,height:16},{page:0,x:32,y:16,width:32,height:16}])
    expect(originalArtRules.at(clip,2).rect).toMatchObject({x:0,y:16})
    expect(()=>applyOriginalMappings(spec,[fixture(id,{columns:3})])).toThrow('grid')
    expect(()=>originalArtRules.layout({...clip,frameRects:[...clip.frameRects!.slice(0,3),{page:1,x:0,y:0,width:32,height:16}]})).toThrow('escapes')
  })
  it('orders sequence pages explicitly and keeps each original URL isolated in cache and metadata reviews',()=>{
    const spec=createFallbackGameSpec('Sequence','Sequence',1),id=spec.assets.find(a=>a.category==='hero')!.id
    const a=fixture(id,{layout:'sequence',sequenceIndex:10,frameCount:1,frameOrder:[1,0]}),b=fixture(id,{layout:'sequence',sequenceIndex:2,url:'data:image/png;base64,BBBB',frameCount:1,frameOrder:[1,0],original:{...a.original,fileName:'frame2.png',sha256:'b'.repeat(64)}})
    const next=applyOriginalMappings(spec,[a,b]),clip=next.assets.find(v=>v.id===id)!.animation!.clips!.idle!
    expect(clip.original?.fileName).toBe('frame2.png');expect(clip.originalPages?.[1].url).toBe(a.url)
    expect(()=>applyOriginalMappings(spec,[a,{...b,sequenceIndex:10}])).toThrow('unique')
    const saved=stripLargeAssetUrls(next),key=`${id}:clip:idle:page:1:original:${a.original.sha256}`
    expect(saved.assets.find(v=>v.id===id)!.animation!.clips!.idle!.originalPages![1].url).toBe('cached-image:'+key)
    const firstKey=`${id}:clip:idle:original:${b.original.sha256}`,restored=hydrateSpecAssetsWithUrls(saved,{[key]:a.url,[firstKey]:b.url})
    expect(restored.assets.find(v=>v.id===id)!.animation!.clips!.idle!.originalPages![1].url).toBe(a.url)
    expect(JSON.stringify(assetMetadataForReview(next))).not.toContain('data:image')
    const missing=hydrateSpecAssetsWithUrls(saved,{[firstKey]:b.url})
    expect(missing.assets.find(v=>v.id===id)!.animation!.clips!.idle!.status).toBe('pending')
  })
  it('uses atlas row/column crops and sequence page selection in the actual exported renderer',async()=>{
    vi.stubGlobal('Image',class{width=64;height=32;tag='';onload?:()=>void;set src(v:string){this.tag=v;this.onload?.()}})
    const configure=(layout:'grid'|'sequence')=>(s:ReturnType<typeof createFallbackGameSpec>)=>{
      const id=s.assets.find(a=>a.category==='hero')!.id,a=fixture(id,{layout,sequenceIndex:0,frameOrder:layout==='grid'?[2,1,3]:[1,0]})
      s.assets=applyOriginalMappings(s,layout==='grid'?[a]:[a,{...a,sequenceIndex:1,url:'data:image/png;base64,BBBB',original:{...a.original,sha256:'b'.repeat(64)}}]).assets
    }
    const grid=await bootOfflineMap(flatMap(),undefined,configure('grid'));grid.tick();expect(grid.draws.at(-1)?.slice(1,5)).toEqual([0,16,32,16])
    grid.tick(7);expect(grid.draws.at(-1)?.slice(1,5)).toEqual([32,0,32,16])
    const sequence=await bootOfflineMap(flatMap(),undefined,configure('sequence'));sequence.tick()
    expect((sequence.draws.at(-1)![0] as {tag:string}).tag).toBe('data:image/png;base64,BBBB')
    sequence.tick(7);expect((sequence.draws.at(-1)![0] as {tag:string}).tag).toBe('data:image/png;base64,AAAA')
  })
  it('packages every original sequence page without changing bytes and sanitizes nested preview references',async()=>{
    const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=','base64'),sha=createHash('sha256').update(bytes).digest('hex'),url='data:image/png;base64,'+bytes.toString('base64')
    const spec=createFallbackGameSpec('Sequence proof','Sequence proof',1);spec.assets=spec.assets.map(a=>({...a,enabled:false,url:undefined,animation:undefined,kind:a.category==='hero'?'image':a.kind}))
    const id=spec.assets.find(a=>a.category==='hero')!.id,a=fixture(id,{layout:'sequence',sequenceIndex:0,frameCount:1,frameOrder:[1,0],url,original:{version:1,fileName:'frame0.png',width:1,height:1,bytes:bytes.length,sha256:sha}}),next=applyOriginalMappings(spec,[a,{...a,sequenceIndex:1,original:{...a.original,fileName:'frame1.png'}}])
    let saved:Blob|undefined
    vi.spyOn(URL,'createObjectURL').mockImplementation(v=>{saved=v as Blob;return 'blob:sequence'})
    vi.stubGlobal('document',{createElement:()=>({click:vi.fn()})});vi.stubGlobal('window',{setTimeout:vi.fn()})
    await exportGameZip(next)
    const files=readStoredGameArchive(await saved!.arrayBuffer()),projectFile=files.find(f=>f.name==='project.json')!,project=JSON.parse(new TextDecoder().decode(projectFile.bytes)),clip=project.assets.find((v:{id:string})=>v.id===id).animation.clips.idle
    for(const file of [clip.url,clip.originalPages[1].url])expect(Buffer.from(files.find(f=>f.name===file)!.bytes)).toEqual(bytes)
    const preview=buildGamePreviewDocument(files,'12345678-1234-4234-8234-123456789abc');expect(preview.resources.some(r=>r.name===clip.originalPages[1].url)).toBe(true)
    const bad=structuredClone(project);bad.assets.find((v:{id:string})=>v.id===id).animation.clips.idle.originalPages[1].url='https://external.invalid/private.png'
    expect(()=>buildGamePreviewDocument(files.map(f=>f.name==='project.json'?{...f,bytes:new TextEncoder().encode(JSON.stringify(bad))}:f),'12345678-1234-4234-8234-123456789abc')).toThrow('external')
    if(process.env.PIXEL_WORLD_STAGE_EVIDENCE){const dir=join(process.env.PIXEL_WORLD_STAGE_EVIDENCE,'layouts-'+createHash('sha256').update(offlineGameRuntimeSource()).digest('hex').slice(0,12));await mkdir(dir,{recursive:true});await writeFile(join(dir,'散帧字节验证包.zip'),new Uint8Array(await saved!.arrayBuffer()));await writeFile(join(dir,'散帧导出GameSpec.json'),projectFile.bytes)}
  })
})
