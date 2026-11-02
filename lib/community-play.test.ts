import {afterEach,describe,it,expect,vi} from 'vitest'
import {createHash,webcrypto} from 'node:crypto'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {runInNewContext} from 'node:vm'
import {createFallbackGameSpec} from './game-spec'
import {exportGameZip,offlineGameRuntimeSource,offlineGameStylesSource} from './export-game'
import engine from '@/configs/offline-engine-source.json'
import {readStoredGameArchive,gameArchiveWorkerSource} from './community-play-archive'
import {buildGamePreviewDocument,GAME_PREVIEW_CSP,GAME_PREVIEW_SANDBOX} from './community-play-document'

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()})
async function archive(language:'zh-CN'|'en'='en',authored=false){
  const spec=createFallbackGameSpec('A penguin finds its mother.','Preview fixture',3,language)
  if(authored)spec.levels[0]={...spec.levels[0],enemyCount:0,collectibleCount:0,hasBoss:false,map:{version:1,width:960,height:1800,groundY:1600,player:{x:37,y:1536,width:32,height:64},exit:{x:800,y:1504,width:64,height:96},obstacles:[{id:'platform',type:'platform',x:300,y:1400,width:130,height:16}],enemies:[],collectibles:[]}}
  spec.assets=spec.assets.map(asset=>({...asset,enabled:false,url:undefined,animation:undefined}))
  const svg=await readFile(new URL('../public/builtin/hero.svg',import.meta.url))
  spec.assets[0]={...spec.assets[0],enabled:true,kind:'image',status:'success',url:`data:image/svg+xml;base64,${svg.toString('base64')}`}
  let saved:Blob|undefined
  vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{saved=blob as Blob;return 'blob:test-export'})
  vi.stubGlobal('document',{createElement:()=>({click:vi.fn()})});vi.stubGlobal('window',{setTimeout:vi.fn()})
  vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No network in export fixture')}))
  await exportGameZip(spec)
  return new Uint8Array(await saved!.arrayBuffer())
}
async function workerCheck(bytes:Uint8Array,overrides:Record<string,unknown>={}){
  const result:Record<string,unknown>[]=[]
  const self={onmessage:undefined as unknown as (event:{data:unknown})=>Promise<void>,postMessage:(value:Record<string,unknown>)=>result.push(value)}
  runInNewContext(gameArchiveWorkerSource(),{self,crypto:webcrypto,TextDecoder,TextEncoder})
  const copy=new Uint8Array(bytes)
  await self.onmessage({data:{buffer:copy.buffer,expected:{bytes:copy.length,sha256:createHash('sha256').update(copy).digest('hex'),engineSha256:engine.sha256,styleSha256:engine.styleSha256,...overrides}}})
  return result[0]
}
describe('native exported ZIP playback without arbitrary uploaded code',()=>{
  it('retains authored maps in preview and rejects altered geometry in duplicated runtime data',async()=>{
    const files=readStoredGameArchive((await archive('en',true)).buffer),encoder=new TextEncoder(),decoder=new TextDecoder()
    const preview=buildGamePreviewDocument(files,'12345678-1234-4234-8234-123456789abc')
    const originalHtml=decoder.decode(files.find(f=>f.name==='index.html')!.bytes)
    const matched=originalHtml.match(/id="runtime-data">([\s\S]*?)<\/script>/)!
    const runtime=JSON.parse(matched[1])
    expect(preview.html).toContain('"worldWidth":960')
    expect(runtime.levels[0].authoredMap.player.x).toBe(37)
    runtime.levels[0].authoredMap.player.x=99
    const modified=files.map(f=>f.name==='index.html'?{...f,bytes:encoder.encode(originalHtml.replace(matched[1],JSON.stringify(runtime)))}:f)
    expect(()=>buildGamePreviewDocument(modified,'12345678-1234-4234-8234-123456789abc')).toThrow(/differs/)
  })
  it('keeps reproducible engine and style bytes across exporter/server builds',()=>{
    expect(offlineGameRuntimeSource()).toBe(engine.source)
    expect(createHash('sha256').update(engine.source).digest('hex')).toBe(engine.sha256)
    expect(offlineGameStylesSource()).toBe(engine.styles)
    expect(createHash('sha256').update(engine.styles).digest('hex')).toBe(engine.styleSha256)
    const output=execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/generate-offline-engine.cjs',import.meta.url)),'--check'],{encoding:'utf8'})
    expect(output).toContain('matches the trusted source factories')
  })
  it.each(['zh-CN','en'] as const)('reads a real %s export and keeps its original layout while mapping images to local blobs',async language=>{
    const bytes=await archive(language),files=readStoredGameArchive(bytes.buffer)
    const output=process.env.PIXEL_WORLD_BROWSER_FIXTURE_DIR
    if(output && language==='en'){
      await mkdir(output,{recursive:true})
      await writeFile(join(output,'synthetic-preview-fixture.zip'),bytes)
      await writeFile(join(output,'fixture-description.json'),JSON.stringify({type:'synthetic isolated browser regression; not a model run or cloud publication',modelCalls:0,language,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),engineSha256:engine.sha256,styleSha256:engine.styleSha256},null,2)+'\n')
    }
    const source=JSON.parse(new TextDecoder().decode(files.find(file=>file.name==='project.json')!.bytes))
    const preview=buildGamePreviewDocument(files,'12345678-1234-4234-8234-123456789abc'),html=preview.html
    expect(html).toContain(`lang="${language}"`)
    const project=JSON.parse(html.match(/id="project-data">([\s\S]*?)<\/script>/)![1])
    const layout=JSON.parse(html.match(/id="runtime-data">([\s\S]*?)<\/script>/)![1])
    const originalHtml=new TextDecoder().decode(files.find(file=>file.name==='index.html')!.bytes)
    const originalLayout=JSON.parse(originalHtml.match(/id="runtime-data">([\s\S]*?)<\/script>/)![1])
    expect(layout.levels.map((level:{obstacles:unknown})=>level.obstacles)).toEqual(originalLayout.levels.map((level:{obstacles:unknown})=>level.obstacles))
    expect(project.hero).toEqual(source.hero);expect(project.weapon).toEqual(source.weapon)
    expect(project.assets[0].url).toBe('assets/hero-1.svg')
    expect(preview.resources.some(item=>item.mime==='image/svg+xml')).toBe(true)
    expect(html).toContain('script nonce="12345678123442348234123456789abc"')
    expect(html).toContain('pixel-world-preview-resources')
    expect(GAME_PREVIEW_SANDBOX).toBe('allow-scripts')
    expect(GAME_PREVIEW_CSP).toContain("connect-src 'none'")
    expect(html).not.toContain('allow-same-origin')
  })
  it('rejects CRC corruption, encrypted/compressed metadata and path traversal before constructing a preview',async()=>{
    const original=await archive()
    const corrupt=new Uint8Array(original);corrupt[30+new DataView(corrupt.buffer).getUint16(26,true)]^=1
    expect(()=>readStoredGameArchive(corrupt.buffer)).toThrow()
    const compressed=new Uint8Array(original),end=compressed.length-22,central=new DataView(compressed.buffer).getUint32(end+16,true)
    new DataView(compressed.buffer).setUint16(central+10,8,true)
    expect(()=>readStoredGameArchive(compressed.buffer)).toThrow()
    const traversal=new Uint8Array(original);traversal.set(new TextEncoder().encode('../bad.htm'),30)
    expect(()=>readStoredGameArchive(traversal.buffer)).toThrow()
  })
  it('checks the whole ZIP and both vetted executable/style hashes inside the worker',async()=>{
    const bytes=await archive()
    expect((await workerCheck(bytes)).ok).toBe(true)
    for(const overrides of [{sha256:'0'.repeat(64)},{engineSha256:'0'.repeat(64)},{styleSha256:'0'.repeat(64)},{bytes:bytes.length+1}])expect((await workerCheck(bytes,overrides)).ok).toBe(false)
  })
  it('ignores arbitrary original HTML and rejects external asset references or unbounded entity counts',async()=>{
    const files=readStoredGameArchive((await archive()).buffer),encoder=new TextEncoder()
    const altered=files.map(file=>file.name==='index.html'?{...file,bytes:encoder.encode(new TextDecoder().decode(file.bytes)+'<script>parent.EVIL_MARKER=1</script>')}:file)
    expect(buildGamePreviewDocument(altered,'12345678-1234-4234-8234-123456789abc').html).not.toContain('EVIL_MARKER')
    const raw=JSON.parse(new TextDecoder().decode(files.find(file=>file.name==='project.json')!.bytes))
    raw.assets[0].url='https://outside.example/tracker.png'
    const external=files.map(file=>file.name==='project.json'?{...file,bytes:encoder.encode(JSON.stringify(raw))}:file)
    expect(()=>buildGamePreviewDocument(external,'12345678-1234-4234-8234-123456789abc')).toThrow(/external/)
    raw.assets[0].url='assets/hero-1.svg';raw.levels[0].enemyCount=1_000_000
    const excessive=files.map(file=>file.name==='project.json'?{...file,bytes:encoder.encode(JSON.stringify(raw))}:file)
    expect(()=>buildGamePreviewDocument(excessive,'12345678-1234-4234-8234-123456789abc')).toThrow(/layout/)
  })
})
