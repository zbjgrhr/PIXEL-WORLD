import type { AnimationClipPose, AnimationClipSpec, GameSpec, OriginalImageSpec } from '@/types'
import { createActionStripAnimation, normalizeAnimationSpec, animationIsComplete } from './asset-catalog'
import { originalArtRules } from './original-art'

export interface OriginalFile { url:string; original:OriginalImageSpec }
export interface OriginalMapping extends OriginalFile { assetId:string; pose?:AnimationClipPose; frameCount:number; fps:number; loop:boolean; frameOrder?:number[]; layout?:'strip'|'grid'|'sequence'; columns?:number; rows?:number; sequenceIndex?:number }
/** Build the selected action with the same grouping and validation used on apply. */
export function buildOriginalPreview(spec:GameSpec,entries:OriginalMapping[],index:number):AnimationClipSpec|undefined {
  const selected=entries[index]
  if(!selected)return undefined
  if(!selected.pose||!selected.assetId)return {frameCount:1,fps:1,loop:false,enabled:true,status:'success',url:selected.url,original:originalArtRules.validate(selected.original)}
  const group=entries.filter(e=>e.assetId===selected.assetId&&e.pose===selected.pose)
  const preview=applyOriginalMappings(spec,group).assets.find(a=>a.id===selected.assetId)!
  return preview.animation!.clips![selected.pose]
}
export async function readOriginalFile(file:File):Promise<OriginalFile> {
  if(!['image/png','image/webp','image/jpeg'].includes(file.type)||!file.size||file.size>10*1024*1024)throw Error('Original images must be PNG, WebP or JPEG, under 10 MB each')
  const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes)
  const url=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(Error('Could not read original image'));r.readAsDataURL(file)})
  const size=await new Promise<{width:number;height:number}>((resolve,reject)=>{const i=new Image();i.onload=()=>resolve({width:i.naturalWidth,height:i.naturalHeight});i.onerror=()=>reject(Error('Could not decode original image'));i.src=url})
  return {url,original:originalArtRules.validate({version:1,fileName:file.name,bytes:file.size,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),...size})}
}
/** Apply all mappings to a copy or throw before changing the caller's spec. */
export function applyOriginalMappings(spec:GameSpec,entries:OriginalMapping[]):GameSpec {
  if(!entries.length||entries.length>32||entries.reduce((n,e)=>n+e.original.bytes,0)>40*1024*1024)throw Error('Import 1–32 files, up to 40 MB per batch')
  const targets=new Set<string>(),modes=new Map<string,boolean>()
  for(const e of entries){
    originalArtRules.validate(e.original)
    if(!/^data:image\/(png|jpeg|webp);base64,/.test(e.url))throw Error('Original file data is missing')
    const asset=spec.assets.find(a=>a.id===e.assetId)
    if(!asset||!['image','spriteSheet'].includes(asset.kind))throw Error('Choose an image asset for every file')
    const key=e.assetId+':'+(e.pose||'static')
    if(targets.has(key)&&!(e.pose&&e.layout==='sequence'&&entries.filter(v=>v.assetId===e.assetId&&v.pose===e.pose).every(v=>v.layout==='sequence'))||modes.has(e.assetId)&&modes.get(e.assetId)!==!!e.pose)throw Error('A target cannot have duplicate actions or mix static and action mappings in one batch')
    targets.add(key);modes.set(e.assetId,!!e.pose)
    if(e.layout&&!['strip','grid','sequence'].includes(e.layout))throw Error('Unsupported original layout')
    if(e.pose){if(!['idle','walk','jump','meleeAttack','rangedAttack','hit','death'].includes(e.pose)||!Number.isFinite(e.fps)||e.fps<1||e.fps>60||typeof e.loop!=='boolean')throw Error('Invalid original action strip configuration');if(!e.layout||e.layout==='strip'){if(!originalArtRules.geometry(e.original.width,e.original.height,e.frameCount))throw Error('Invalid original action strip configuration');originalArtRules.order(e.frameOrder,e.frameCount)}
      if(e.layout==='grid'&&(!Number.isInteger(e.columns)||!Number.isInteger(e.rows)||e.columns!<1||e.rows!<1||e.columns!>64||e.rows!>64||e.original.width%e.columns!||e.original.height%e.rows!||!Number.isInteger(e.frameCount)||e.frameCount<1||e.frameCount>64||e.frameCount>e.columns!*e.rows!))throw Error('Invalid atlas grid')
      if(e.layout==='sequence'&&(!Number.isInteger(e.sequenceIndex)||e.sequenceIndex!<0||e.sequenceIndex!>100000))throw Error('Sequence files need unique nonnegative order numbers')
    }
  }
  const assets=spec.assets.map(asset=>{
    const mapped=entries.filter(e=>e.assetId===asset.id)
    if(!mapped.length)return asset
    const first=mapped[0]
    if(!first.pose)return {...asset,kind:'image' as const,enabled:true,animation:undefined,url:first.url,original:first.original,source:undefined,status:'success' as const,error:undefined}
    const animation=asset.kind==='spriteSheet'?normalizeAnimationSpec(asset.animation):createActionStripAnimation()
    const clips={...animation.clips}
    if(asset.kind!=='spriteSheet'){
      for(const pose of Object.keys(clips) as AnimationClipPose[])clips[pose]={...clips[pose]!,enabled:false}
      clips.idle={...clips.idle!,enabled:true}
      if(asset.url)clips.idle={...clips.idle!,frameCount:1,fps:1,enabled:true,url:asset.url,original:asset.original,source:asset.source,status:'success'}
    }
    for(const pose of new Set(mapped.map(e=>e.pose!))){
      const group=mapped.filter(e=>e.pose===pose),e=group[0]
      if(e.layout==='sequence'){
        const sorted=[...group].sort((a,b)=>a.sequenceIndex!-b.sequenceIndex!)
        if(new Set(sorted.map(v=>v.sequenceIndex)).size!==sorted.length||sorted.some(v=>v.fps!==e.fps||v.loop!==e.loop||JSON.stringify(v.frameOrder)!==JSON.stringify(e.frameOrder)))throw Error('A frame sequence needs unique order numbers and matching FPS, loop and frame order settings')
        clips[pose]={frameCount:sorted.length,fps:e.fps,loop:e.loop,enabled:true,status:'success',url:sorted[0].url,original:sorted[0].original,originalPages:sorted.map((v,i)=>({original:v.original,...(i?{url:v.url}:{})})),frameRects:sorted.map((v,i)=>({page:i,x:0,y:0,width:v.original.width,height:v.original.height})),frameOrder:originalArtRules.order(e.frameOrder,sorted.length)}
      }else if(e.layout==='grid'){
        clips[pose]={frameCount:e.frameCount,fps:e.fps,loop:e.loop,enabled:true,status:'success',url:e.url,original:e.original,originalPages:[{original:e.original}],frameRects:Array.from({length:e.frameCount},(_,i)=>({page:0,x:i%e.columns!*e.original.width/e.columns!,y:Math.floor(i/e.columns!)*e.original.height/e.rows!,width:e.original.width/e.columns!,height:e.original.height/e.rows!})),frameOrder:originalArtRules.order(e.frameOrder,e.frameCount)}
      }else clips[pose]={frameCount:e.frameCount,fps:e.fps,loop:e.loop,enabled:true,url:e.url,original:e.original,frameOrder:originalArtRules.order(e.frameOrder,e.frameCount),status:'success'}
      originalArtRules.layout(clips[pose]!)
    }
    const next={...asset,kind:'spriteSheet' as const,enabled:true,animation:{...animation,clips},url:clips.idle?.url,original:clips.idle?.original,source:undefined,error:undefined}
    return {...next,status:animationIsComplete(next)?'success' as const:'pending' as const}
  })
  return {...spec,assets}
}
