import type { OriginalImageSpec, AnimationClipSpec } from '@/types'

function createOriginalArtRules() {
  function validate(value:unknown):OriginalImageSpec {
    const m=value as OriginalImageSpec
    if(!m||m.version!==1||typeof m.fileName!=='string'||m.fileName.length>240||!m.fileName.trim()||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256)||![m.width,m.height,m.bytes].every(Number.isInteger)||m.width<1||m.height<1||m.width>4096||m.height>4096||m.bytes<1||m.bytes>10*1024*1024)throw Error('Invalid original image metadata')
    return {version:1,fileName:m.fileName,sha256:m.sha256,width:m.width,height:m.height,bytes:m.bytes}
  }
  function order(value:unknown,count:number):number[] {
    if(!Number.isInteger(count)||count<1||count>64)throw Error('Original strips require 1–64 frames')
    if(value===undefined)return Array.from({length:count},(_,i)=>i)
    if(!Array.isArray(value)||!value.length||value.length>256||value.some(v=>!Number.isInteger(v)||v<0||v>=count))throw Error('Frame order uses zero-based indices within the strip (maximum 256 entries)')
    return [...value]
  }
  function geometry(width:number,height:number,count:number){return Number.isInteger(count)&&count>=1&&count<=64&&Number.isInteger(width)&&width>=1&&width<=4096&&width%count===0&&Number.isInteger(height)&&height>=1&&height<=4096}
  function layout(clip:Partial<AnimationClipSpec>){
    if(!clip.originalPages&&!clip.frameRects)return undefined
    if(!clip.original||!Array.isArray(clip.originalPages)||!clip.originalPages.length||clip.originalPages.length>64||!Array.isArray(clip.frameRects)||clip.frameRects.length!==clip.frameCount)throw Error('Original pages and frame rectangles must be supplied together')
    order(undefined,clip.frameCount!)
    const pages=clip.originalPages.map((p,i)=>{if(!p||Object.keys(p).some(k=>!['original','url'].includes(k))||i===0&&p.url!==undefined||p.url!==undefined&&typeof p.url!=='string')throw Error('Invalid original page');return {original:validate(p.original),...(p.url?{url:p.url}:{})}})
    if(pages[0].original.sha256!==clip.original.sha256||pages[0].original.width!==clip.original.width||pages[0].original.height!==clip.original.height||pages.reduce((sum,p)=>sum+p.original.bytes,0)>40*1024*1024)throw Error('Invalid original page identity or byte budget')
    const rects=clip.frameRects.map(r=>{if(!r||Object.keys(r).some(k=>!['page','x','y','width','height'].includes(k))||![r.page,r.x,r.y,r.width,r.height].every(Number.isInteger)||r.page<0||r.page>=pages.length||r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>pages[r.page].original.width||r.y+r.height>pages[r.page].original.height)throw Error('Frame rectangle escapes its original image');return {page:r.page,x:r.x,y:r.y,width:r.width,height:r.height}})
    return {originalPages:pages,frameRects:rects}
  }
  function at(clip:AnimationClipSpec,index:number){
    if(!clip.original)throw Error('Original metadata required')
    if(clip.frameRects&&clip.originalPages){const rect=clip.frameRects[index],page=clip.originalPages[rect.page];return {rect,original:page.original,url:rect.page===0?clip.url:page.url,page:rect.page}}
    return {rect:{x:index*clip.original.width/clip.frameCount,y:0,width:clip.original.width/clip.frameCount,height:clip.original.height,page:0},original:clip.original,url:clip.url,page:0}
  }
  function frame(clip:AnimationClipSpec,elapsed:number){const frames=order(clip.frameOrder,clip.frameCount),index=Math.floor(Math.max(0,elapsed)*Math.max(1,Math.min(60,clip.fps))/1000);return frames[clip.loop?index%frames.length:Math.min(frames.length-1,index)]}
  return {validate,order,geometry,frame,layout,at}
}
export const originalArtRules=createOriginalArtRules()
export function offlineOriginalArtSource(){return `const originalArtRules=(${createOriginalArtRules.toString()})();`}
