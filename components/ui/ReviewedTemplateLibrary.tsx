'use client'
import {useEffect,useRef,useState} from 'react'
import {Alert,Button,Popconfirm,Spin,Tag} from 'antd'
import type {CreationLanguage,TemplateReuseSelection} from '@/types'
import type {ReviewedTemplate} from '@/lib/community-template'
import CommunityAuthor from '../CommunityAuthor'
import CommunityMediaGallery from '../CommunityMediaGallery'
import CommunityGamePreview from '../CommunityGamePreview'
import {useUiLocale} from './LanguageSwitcher'

export default function ReviewedTemplateLibrary({language,open,busy=false,draftKey='',onApply}:{language:CreationLanguage;open:boolean;busy?:boolean;draftKey?:string;onApply?:(selection:TemplateReuseSelection)=>boolean}){
  const en=useUiLocale()==='en'
  const [templates,setTemplates]=useState<ReviewedTemplate[]>([]),[loading,setLoading]=useState(false),[configured,setConfigured]=useState<boolean|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0)
  const [selecting,setSelecting]=useState(false),[selectionError,setSelectionError]=useState(false)
  const selectionLock=useRef(false),selectionController=useRef<AbortController|null>(null)
  const latest=useRef({language,open,busy,draftKey,onApply})
  latest.current={language,open,busy,draftKey,onApply}
  useEffect(()=>()=>{selectionController.current?.abort()},[language,open,draftKey,busy])
  const select=async(template:ReviewedTemplate,mode:'story'|'complete')=>{
    if(selectionLock.current || busy || !onApply)return
    selectionLock.current=true;setSelecting(true);setSelectionError(false)
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60_000),context=latest.current
    selectionController.current=controller
    try{
      const params=new URLSearchParams({mode,language,revision:template.revision})
      const response=await fetch(`/api/community/templates/${template.postId}/reuse?${params}`,{cache:'no-store',signal:controller.signal})
      if(!response.ok)throw new Error('reuse')
      const result=await response.json()
      if(controller.signal.aborted || !latest.current.open || latest.current.busy || latest.current.language!==context.language || latest.current.draftKey!==context.draftKey)return
      if(result.requiresReview!==true || result.selection?.language!==language)throw new Error('reuse')
      if(latest.current.onApply?.(result.selection)===false)setSelectionError(true)
    }catch{if(!controller.signal.aborted)setSelectionError(true)}finally{clearTimeout(timer);selectionLock.current=false;setSelecting(false)}
  }
  useEffect(()=>{
    if(!open)return
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000)
    let active=true
    setTemplates([]);setLoading(true);setError(false);setConfigured(null)
    void fetch(`/api/community/templates?language=${encodeURIComponent(language)}`,{cache:'no-store',signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('templates')
      const data=await response.json()
      if(active){setConfigured(data.configured===true);setTemplates(data.templates)}
    }).catch(()=>{if(active)setError(true)}).finally(()=>{clearTimeout(timer);if(active)setLoading(false)})
    return()=>{active=false;clearTimeout(timer);controller.abort()}
  },[language,open,retry])
  return <section aria-label={en?'Reviewed game templates':'已复核成品模板'}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><h3>{en?'Reviewed Game Templates':'已复核成品模板'}</h3><Button disabled={loading} onClick={()=>setRetry(value=>value+1)}>{en?'Refresh':'刷新'}</Button></div>
    <p>{en?'These works require separate quality review, browser and offline completion evidence, and permission to adapt with attribution. They are distinct from the starter examples below.':'这里仅展示单独通过质量复核、有网页及离线通关证据、允许署名改编的作品，与下方示例设定分开。'}</p>
    {error && <Alert type="warning" showIcon message={en?'Reviewed templates could not be checked. No unverified work has been substituted.':'暂时无法核对成品模板，没有用未验收作品替代。'} />}
    {selectionError && <Alert type="warning" showIcon message={en?'This template could not be applied. Your input is unchanged. Refresh the library to check its current version and reuse permission.':'模板未能应用，当前输入已保留。请刷新工坊，核对最新版本与复用许可。'} />}
    {configured===false && <p>{en?'The community service is not configured. Starter examples remain available.':'社区服务尚未配置，仍可使用下方示例设定。'}</p>}
    <Spin spinning={loading}><div className="workshop-grid">{templates.map(template=><article className="workshop-card" key={`${template.postId}:${template.revision}`} data-no-ui-translation>
      <CommunityAuthor author={template.author} />
      <Tag>{en?'Quality review accepted':'已通过质量复核'}</Tag><Tag>{template.language==='en'?'English':'简体中文'}</Tag><Tag>{template.levelCount}{en?' levels':'关'}</Tag>
      <h4>{template.title}</h4><p style={{whiteSpace:'pre-wrap'}}>{template.story}</p>
      <p>{en?'Text model: ':'文字模型：'}{template.models.textModelId}<br/>{en?'Image model: ':'图片模型：'}{template.models.imageModelId}</p>
      <p>{en?'Supplemented tasks: ':'自动补齐：'}{template.fallback.supplementedTasks}/{template.fallback.totalImageTasks}{template.fallback.totalImageTasks>0?` (${Math.round(template.fallback.supplementedTasks/template.fallback.totalImageTasks*1000)/10}%)`:''}</p>
      <CommunityMediaGallery postId={template.postId} revision={template.revision} />
      <CommunityGamePreview postId={template.postId} revision={template.revision} />
      <Button href={`/community?game=${template.postId}`} target="_blank" rel="noopener noreferrer">{en?'View Work and Downloads':'查看作品与下载'}</Button>
      <p>{en?'Applying a template replaces the current title, story and settings. The existing game is retained; the new draft requires review. Images are not copied.':'应用会替换当前名称、故事和设定。原成品保留，新草案需要重新审核，图片不会复制。'}</p>
      {(['story','complete'] as const).map(mode=><Popconfirm key={mode} title={en?'Replace the current creative input?':'替换当前创作输入？'} okText={en?'Apply':'应用'} cancelText={en?'Cancel':'取消'} onConfirm={()=>select(template,mode)}><Button disabled={busy || selecting || !onApply} loading={selecting}>{mode==='story'?(en?'Use Story Only':'只用故事'):(en?'Use Full Settings':'沿用完整设定')}</Button></Popconfirm>)}
    </article>)}</div></Spin>
    {configured && !loading && !error && !templates.length && <p>{en?'No reviewed work is available in this language yet.':'该语言暂时没有已复核成品。'}</p>}
  </section>
}
