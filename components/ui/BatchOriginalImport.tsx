'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Alert, Button, Collapse, Input, InputNumber, Select, Space, Switch } from 'antd'
import type { AnimationClipPose, GameSpec } from '@/types'
import { applyOriginalMappings, buildOriginalPreview, readOriginalFile, type OriginalMapping } from '@/lib/batch-original-import'
import { originalArtRules } from '@/lib/original-art'
import { useUiLocale } from './LanguageSwitcher'

type Row=OriginalMapping&{id:string;orderText:string}
export default function BatchOriginalImport({spec,onApply,disabled}:{spec:GameSpec;onApply:(base:GameSpec,next:GameSpec)=>Promise<void>;disabled:boolean}){
  const en=useUiLocale()==='en',[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[selected,setSelected]=useState(0),[time,setTime]=useState(0)
  const [box,setBox]=useState({x:0,y:0,width:16,height:16}),generation=useRef(0),live=useRef(spec),base=useRef(spec)
  const clipId='original-frame-'+useId().replace(/[^a-z0-9_-]/gi,'')
  const hasAnimation=rows.some(r=>!!r.pose)
  live.current=spec
  useEffect(()=>()=>{generation.current++},[])
  useEffect(()=>{
    if(!hasAnimation)return
    // A 100 ms step aliases 3-frame/30 FPS clips back onto the same frame.
    // Advance at display cadence, including where high-resolution clocks pause.
    const step=1000/60
    const timer=window.setInterval(()=>setTime(t=>t+step),step)
    return()=>window.clearInterval(timer)
  },[hasAnimation])
  const patch=(id:string,p:Partial<Row>)=>setRows(list=>list.map(r=>r.id===id?{...r,...p}:r))
  const preview=rows[Math.min(selected,rows.length-1)]
  const prepared=useMemo(()=>{try{return {clip:buildOriginalPreview(spec,rows.map(r=>({...r,frameOrder:r.orderText.trim()?r.orderText.trim().split(/[,\s]+/).map(Number):undefined})),Math.min(selected,rows.length-1)),error:''}}catch(e){return {clip:undefined,error:String(e)}}},[spec,rows,selected])
  const frame=prepared.clip?originalArtRules.frame(prepared.clip,time):0
  const source=prepared.clip?originalArtRules.at(prepared.clip,frame):preview?{url:preview.url,original:preview.original,rect:{x:0,y:0,width:preview.original.width,height:preview.original.height}}:undefined
  const cell=source?.rect.width||1,cellHeight=source?.rect.height||1
  return <div data-no-ui-translation><Collapse size="small" items={[{key:'batch',label:en?'Batch original art · preserve source pixels':'批量原图 · 保留原始文件',children:<Space direction="vertical" style={{width:'100%'}}>
    <p>{en?'Select up to 32 PNG/WebP/JPEG files (40 MB total, 10 MB each). Map files to static art, strips, multirow grids or a shared action sequence. Sequence rows use unique order numbers and matching FPS, loop and playback order. All source bytes stay unchanged.':'一次选择最多32份PNG/WebP/JPEG，合计40MB、单份10MB。支持静态、横条、多行图集或同一动作散帧。散帧填写不同顺序号，并保持组内FPS/循环/播放帧序一致。保留原始文件，不进行AI重画或抠图。'}</p>
    <input aria-label="Batch original image files" type="file" multiple accept="image/png,image/webp,image/jpeg" disabled={disabled||busy} onChange={async e=>{
      const files=Array.from(e.target.files||[]);e.target.value='';if(!files.length)return
      if(files.length>32||files.reduce((n,f)=>n+f.size,0)>40*1024*1024){setError(en?'Maximum 32 files / 40 MB.':'最多32份/40MB。');return}
      const token=++generation.current,expected=spec;base.current=spec;setBusy(true);setRows([]);setError('');setNotice('')
      try{const imported=await Promise.all(files.map(readOriginalFile));if(token!==generation.current)return;if(live.current!==expected)throw Error(en?'The draft changed; select the files again.':'草稿已变化，请重新选择文件。');setRows(imported.map((file,i)=>({...file,id:crypto.randomUUID(),assetId:'',frameCount:1,fps:8,loop:false,layout:'strip' as const,columns:1,rows:1,sequenceIndex:i,orderText:''})));setSelected(0);setTime(0)}catch(e){if(token===generation.current)setError(String(e))}finally{if(token===generation.current)setBusy(false)}
    }}/>
    {rows.length>1&&<Button disabled={busy||disabled} onClick={()=>setRows(list=>[...list].sort((a,b)=>a.original.fileName.localeCompare(b.original.fileName,undefined,{numeric:true})).map((r,i)=>({...r,sequenceIndex:i})))}>{en?'Sort sequence files by name':'按文件名自然排序散帧'}</Button>}
    {rows.map((r,i)=><div key={r.id} style={{padding:10,border:'1px solid #b8c9b8',borderRadius:8,width:'100%',boxSizing:'border-box'}}>
      <strong>{i+1}. {r.original.fileName}</strong><small> · {r.original.width}×{r.original.height} · {(r.original.bytes/1024).toFixed(1)} KB</small>
      <Space wrap style={{marginTop:8}}><Select aria-label={'Import target '+i} disabled={disabled||busy} placeholder={en?'Choose asset':'选择目标素材'} style={{minWidth:180}} value={r.assetId||undefined} onChange={assetId=>patch(r.id,{assetId})} options={spec.assets.filter(a=>a.kind==='image'||a.kind==='spriteSheet').map(a=>({value:a.id,label:a.title+' · '+a.category}))}/>
      <Select aria-label={'Import action '+i} disabled={disabled||busy} value={r.pose||'static'} onChange={v=>patch(r.id,{pose:v==='static'?undefined:v as AnimationClipPose,loop:v==='walk'})} options={['static','idle','walk','jump','meleeAttack','rangedAttack','hit','death'].map(value=>({value,label:({static:en?'Static image':'单张静态',idle:en?'Idle':'站立',walk:en?'Walk':'行走',jump:en?'Jump':'跳跃',meleeAttack:en?'Melee':'近战',rangedAttack:en?'Ranged':'远程',hit:en?'Hit':'受击',death:en?'Death':'死亡'})[value]}))}/>
      <Button onClick={()=>{setSelected(i);setTime(0);setBox({x:0,y:0,width:r.original.width/(r.pose?r.frameCount:1),height:r.original.height})}}>{en?'Preview':'预览'}</Button></Space>
      {r.pose&&<Space wrap style={{marginTop:8}}><Select aria-label={'Import layout '+i} disabled={disabled||busy} value={r.layout||'strip'} onChange={layout=>patch(r.id,{layout})} options={[{value:'strip',label:en?'Horizontal strip':'横向帧条'},{value:'grid',label:en?'Multirow atlas':'多行图集'},{value:'sequence',label:en?'Individual frame':'散帧文件'}]}/>{r.layout==='grid'&&<>{(['columns','rows'] as const).map(k=><label key={k}>{k} <InputNumber aria-label={'Import '+k+' '+i} disabled={disabled||busy} min={1} max={64} precision={0} value={r[k]} onChange={v=>{if(v)patch(r.id,{[k]:v})}}/></label>)}</>}{r.layout==='sequence'&&<label>{en?'File sequence index':'文件顺序号'} <InputNumber aria-label={'Import sequence index '+i} min={0} max={100000} precision={0} disabled={disabled||busy} value={r.sequenceIndex} onChange={v=>{if(v!==null)patch(r.id,{sequenceIndex:v})}}/></label>}<label>{en?'Frames':'帧数'} <InputNumber aria-label={'Import frames '+i} disabled={disabled||busy||r.layout==='sequence'} min={1} max={64} precision={0} value={r.frameCount} onChange={v=>{if(v)patch(r.id,{frameCount:v})}}/></label><label>FPS <InputNumber aria-label={'Import fps '+i} disabled={disabled||busy} min={1} max={60} value={r.fps} onChange={v=>{if(v)patch(r.id,{fps:v})}}/></label><label><Switch aria-label={'Import loop '+i} disabled={disabled||busy} checked={r.loop} onChange={loop=>patch(r.id,{loop})}/>{en?'Loop':'循环'}</label><Input aria-label={'Import frame order '+i} disabled={disabled||busy} placeholder={en?'Frame order: 0,1,2,1 (empty: sequential)':'帧序：0,1,2,1（空为顺序）'} value={r.orderText} onChange={e=>patch(r.id,{orderText:e.target.value})}/></Space>}
    </div>)}
    {preview&&source&&<><strong>{en?'Source preview and collision reference':'原图与碰撞参考预览'} · {source.original.fileName} · {frame} / {prepared.clip?.frameCount||1} · {prepared.clip?.fps||1} FPS</strong>{prepared.error&&<Alert type="warning" message={prepared.error}/>}<svg aria-label="Original art preview" role="img" viewBox={`0 0 ${cell} ${cellHeight}`} style={{width:280,height:220,background:'repeating-conic-gradient(#e7ece7 0% 25%,#fafcfa 0% 50%) 50% / 16px 16px',border:'1px solid #b8c9b8'}}>
      <defs><clipPath id={clipId}><rect width={cell} height={cellHeight}/></clipPath></defs><image href={source.url} x={-source.rect.x} y={-source.rect.y} width={source.original.width} height={source.original.height} clipPath={`url(#${clipId})`}/><rect {...box} fill="none" stroke="#e06032" strokeWidth={Math.max(cell,cellHeight)/120}/>
    </svg><Space wrap>{(['x','y','width','height'] as const).map(k=><label key={k}>{k} <InputNumber aria-label={'Preview collision '+k} min={0} value={box[k]} onChange={v=>{if(v!==null)setBox(b=>({...b,[k]:v}))}}/></label>)}</Space><small>{en?'Choose an asset and action to preview the entire mapped group, including file order, FPS and looping. The orange box is a source-pixel reference preview. Set actual game collider dimensions in the map or character editor. One-shot animations may be cut short by the gameplay action window.':'选定目标素材和动作后，按整组文件顺序、FPS及循环设置预览。橙框仅为原图像素坐标的碰撞参考预览；实际游戏碰撞尺寸在地图/角色编辑器设置。一次性动作仍可能受游戏动作窗口截短。'}</small></>}
    <Button type="primary" disabled={disabled||busy||!rows.length} loading={busy} onClick={async()=>{setError('');setNotice('');if(base.current!==spec){setError(en?'Draft changed; select files again.':'草稿已变化，请重新选择文件。');return}setBusy(true);try{const entries=rows.map(r=>({...r,frameOrder:r.orderText.trim()?r.orderText.trim().split(/[,\s]+/).map(Number):undefined}));const next=applyOriginalMappings(spec,entries);await onApply(spec,next);setRows([]);setNotice(en?'Original files applied and cached.':'原图已应用并缓存。')}catch(e){setError(String(e))}finally{setBusy(false)}}}>{en?'Apply all mappings':'应用整批映射'}</Button>
    {error&&<Alert type="error" message={error}/>} {notice&&<Alert type="success" message={notice}/>}<small>{en?'No files are sent to a model or public community by this importer.':'此导入过程不会将文件发送给模型或公开社区。'}</small>
  </Space>}]} /></div>
}
