'use client'
import { useState } from 'react'
import {Alert,Button,Checkbox,Input,Modal,Select} from 'antd'
import {TEMPLATE_CHECKS,type TemplateCheck} from '@/lib/community-template-review'
import CommunityExperimentDetails from './CommunityExperimentDetails'
import CommunityMediaGallery from './CommunityMediaGallery'
import {useUiLocale} from './ui/LanguageSwitcher'

export default function CommunityTemplateReview({postId,revision,reuse}:{postId:string;revision:string;reuse:string}){
  const en=useUiLocale()==='en'
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState(false)
  const [ready,setReady]=useState<string[]|null>(null),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [checks,setChecks]=useState<Partial<Record<TemplateCheck,{note:string;evidenceIds:string[]}>>>({})
  const label=(key:TemplateCheck)=>en?({storyFidelity:'Story fidelity',artQuality:'Artwork quality',webPlaythrough:'Browser playthrough',offlinePlaythrough:'Offline playthrough'}[key]):({storyFidelity:'故事忠实度',artQuality:'素材质量',webPlaythrough:'网页通关',offlinePlaythrough:'离线通关'}[key])
  const complete=!!ready?.length && TEMPLATE_CHECKS.every(key=>checks[key]?.note.trim() && checks[key]?.evidenceIds.length)
  const save=async(decision:'accepted'|'rejected')=>{
    setBusy(true);setError(false)
    try{
      const response=await fetch(`/api/community/posts/${postId}/template-review`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20_000),body:JSON.stringify({updatedAt:revision,decision,note,reviewedMediaIds:ready || [],checks:decision==='accepted'?Object.fromEntries(TEMPLATE_CHECKS.map(key=>[key,{...checks[key],state:'passed'}])):{}})})
      if(!response.ok)throw new Error('review')
      setSaved(true);setOpen(false)
    }catch{setError(true)}finally{setBusy(false)}
  }
  return <>
    <Button onClick={()=>{setOpen(true);setSaved(false);setError(false);setConfirmed(false);setReady(null)}}>{en?'Review for Template Selection':'审核是否入选模板'}</Button>
    {saved && <p role="status">{en?'Template review recorded.':'模板复核决定已保存。'}</p>}
    <Modal open={open} width={760} title={en?'Template Quality Review':'优秀模板质量复核'} footer={null} destroyOnHidden closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={()=>{if(!busy)setOpen(false)}}>
      <p>{en?'Publication and template selection are separate decisions. Review the actual game and all evidence; author-reported results alone are insufficient.':'允许公开与入选模板是两件事。请核对真实游戏与全部证据，不能只根据作者填写的“通过”作决定。'}</p>
      {reuse!=='remix-with-credit' && <Alert type="warning" showIcon message={en?'The author has not permitted adaptation. This post cannot be selected as a reusable template.':'作者未允许署名改编，当前作品不能入选可复用模板。'} />}
      <CommunityExperimentDetails postId={postId} revision={revision} />
      <CommunityMediaGallery postId={postId} revision={revision} onReady={setReady} busy={busy} />
      <p>{en?'Inspect every attachment, including the ZIP and GameSpec. For each criterion, record what you checked and select the supporting attachment IDs.':'请检查全部附件，包括ZIP和GameSpec。逐项写明核对结果，并选择支持该结论的附件ID。'}</p>
      {TEMPLATE_CHECKS.map(key=><div key={key} style={{marginBlock:12}}>
        <label>{label(key)}<Input.TextArea rows={2} maxLength={2000} disabled={busy} value={checks[key]?.note || ''} onChange={event=>setChecks(old=>({...old,[key]:{note:event.target.value,evidenceIds:old[key]?.evidenceIds || []}}))} /></label>
        <Select mode="multiple" style={{width:'100%'}} disabled={busy || !ready} value={checks[key]?.evidenceIds || []} aria-label={`${label(key)} ${en?'evidence':'证据'}`} options={(ready || []).map(id=>({value:id,label:id}))} onChange={ids=>setChecks(old=>({...old,[key]:{note:old[key]?.note || '',evidenceIds:ids}}))} />
      </div>)}
      <label>{en?'Decision note':'审核说明'}<Input.TextArea rows={3} maxLength={2000} disabled={busy} value={note} onChange={event=>setNote(event.target.value)} /></label>
      <Checkbox disabled={busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}>{en?'I checked the actual results for all four criteria, including browser and offline completion.':'我已核对四项实际结果，包括网页和离线通关。'}</Checkbox>
      {error && <Alert type="error" showIcon message={en?'The review was not confirmed. Refresh the post and check its version, completion evidence and reuse permission before another submission.':'未能确认审核结果。请先刷新帖子，核对版本、通关证据与复用许可，再决定是否重新提交。'} />}
      <div style={{display:'flex',gap:12,marginTop:16}}>
        <Button type="primary" loading={busy} disabled={!complete || !confirmed || !note.trim() || reuse!=='remix-with-credit'} onClick={()=>void save('accepted')}>{en?'Accept for Template Selection':'通过模板复核'}</Button>
        <Button disabled={busy || !note.trim()} onClick={()=>void save('rejected')}>{en?'Decline Template Selection':'暂不入选模板'}</Button>
      </div>
    </Modal>
  </>
}
