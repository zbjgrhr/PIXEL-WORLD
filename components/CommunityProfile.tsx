'use client'
import { useEffect, useState } from 'react'
import { Alert, Checkbox, Input, Modal, Select, Spin } from 'antd'
import { useUiLocale } from './ui/LanguageSwitcher'
import CommunityAuthor from './CommunityAuthor'
import type { ProfileRow, PublicAuthor } from '@/lib/community-profile'

export default function CommunityProfile({ open,onClose,onSaved }: {open:boolean;onClose:()=>void;onSaved:()=>void}) {
  const en = useUiLocale() === 'en'
  const [profile,setProfile] = useState<ProfileRow | null>(null), [name,setName] = useState(''), [avatar,setAvatar] = useState<string | null>(null)
  const [author,setAuthor] = useState<PublicAuthor | null>(null), [images,setImages] = useState<{id:string;original_name:string | null}[]>([])
  const [loading,setLoading] = useState(false), [saving,setSaving] = useState(false), [ready,setReady] = useState(false), [consent,setConsent] = useState(false), [error,setError] = useState(''), [retry,setRetry] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),15_000)
    let active = true
    setLoading(true); setReady(false); setError(''); setConsent(false)
    void fetch('/api/community/profile',{cache:'no-store',signal:controller.signal}).then(async response => {
      if (!response.ok) throw new Error('load')
      const data = await response.json()
      if (active) { setProfile(data.profile); setAuthor(data.author); setName(data.profile?.display_name || ''); setAvatar(data.profile?.avatar_media_id || null); setImages(data.images); setReady(true) }
    }).catch(()=>{ if(active) setError('load') }).finally(()=>{clearTimeout(timer);if(active)setLoading(false)})
    return ()=>{active=false;clearTimeout(timer);controller.abort()}
  },[open,retry])
  const save = async () => {
    setSaving(true);setError('')
    try {
      const response = await fetch('/api/community/profile',{method:'PATCH',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(20_000),body:JSON.stringify({name,avatarMediaId:avatar,updatedAt:profile?.updated_at || null,avatarPublicConsent:consent})})
      if(response.status===409){setReady(false);setError('conflict');return}
      if(!response.ok)throw new Error('save')
      onSaved();onClose()
    }catch{setReady(false);setError('save')}finally{setSaving(false)}
  }
  const changedAvatar = !!avatar && avatar !== profile?.avatar_media_id
  const options = [...images.map(image=>({value:image.id,label:image.original_name || image.id})),...(avatar && !images.some(image=>image.id===avatar)?[{value:avatar,label:en?'Current avatar':'当前头像'}]:[])]
  return <Modal open={open} title={en?'Author Profile':'作者资料'} onCancel={()=>{if(!saving)onClose()}} onOk={()=>void save()} closable={!saving} maskClosable={!saving} keyboard={!saving} confirmLoading={saving} cancelButtonProps={{disabled:saving}} okButtonProps={{disabled:!ready || !name.trim() || loading || changedAvatar && !consent}} okText={en?'Save Profile':'保存资料'} cancelText={en?'Cancel':'取消'}>
    <Spin spinning={loading}>
      {error && <Alert type="error" showIcon message={error==='conflict'?(en?'This profile changed elsewhere. Reload before saving.':'资料已在其他页面更新，请重新加载后再保存。'):error==='load'?(en?'Profile could not be loaded.':'暂时无法加载作者资料。'):(en?'The save could not be confirmed. Reload to check the result before trying again.':'未能确认保存结果。请先重新加载核对，再决定是否重试。')} action={<button disabled={saving} onClick={()=>setRetry(value=>value+1)}>{en?'Reload':'重新加载'}</button>} />}
      {author && <CommunityAuthor author={author} />}
      <label>{en?'Public display name':'公开昵称'}<Input maxLength={80} disabled={saving || !ready} value={name} onChange={event=>setName(event.target.value)} /></label>
      <p>{en?'Choose a verified static image from Manage Uploads: up to 5 MB and 4096 pixels per side. The list shows your 100 most recent eligible images.':'从“管理上传”中选择已通过检查的静态图片：不超过5 MB，单边不超过4096像素。这里显示最近100张符合条件的图片。'}</p>
      <Select style={{width:'100%'}} allowClear disabled={saving || !ready} value={avatar} options={options} aria-label={en?'Profile image':'头像图片'} placeholder={en?'No avatar':'不使用头像'} onChange={value=>{setAvatar(value || null);setConsent(false)}} />
      {changedAvatar && <Checkbox disabled={saving} checked={consent} onChange={event=>setConsent(event.target.checked)}>{en?'Publish a cropped thumbnail of this image as my avatar.':'将这张图片的裁剪缩略图公开作为我的头像。'}</Checkbox>}
      <p>{en?'The original file keeps its existing access permissions. Cached thumbnails may remain visible for up to one minute after removal. A display name does not confer official status.':'原文件仍按原有权限保护。移除头像后，已缓存的缩略图可能最多保留一分钟。设置昵称不会获得官方身份。'}</p>
    </Spin>
  </Modal>
}
