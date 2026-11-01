'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Popconfirm, Spin } from 'antd'
import { useUiLocale } from './ui/LanguageSwitcher'

interface Media { id: string; kind: string | null; bytes: number | null; durationSeconds: number | null; verified: boolean; canDownload: boolean }
interface Props { postId: string; revision: string; onReady?: (ids: string[] | null) => void; onDetach?: (mediaId: string) => Promise<void>; busy?: boolean }

function AttachmentDownload({ postId, item, onChecked }: { postId: string; item: Media; onChecked?: (checked: boolean) => void }) {
  const en = useUiLocale() === 'en'
  const [link, setLink] = useState<{ url: string; filename: string; sha256: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [offered, setOffered] = useState(false)
  const [checked, setChecked] = useState(false)
  const requestLink = async () => {
    if (busy) return
    setBusy(true); setError(false); setLink(null); setOffered(false); setChecked(false); onChecked?.(false)
    try {
      const response = await fetch(`/api/community/posts/${postId}/media?mediaId=${item.id}&download=1`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error('download')
      const data = await response.json(), url = new URL(data.url)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error('url')
      setLink({ url: url.href, filename: data.filename, sha256: data.sha256 })
    } catch { setError(true) }
    finally { setBusy(false) }
  }
  if (!item.canDownload) return <p>{en ? 'The author has not enabled downloads for this post.' : '作者未开放这篇帖子的附件下载。'}</p>
  return <div className="community-media-item">
    <p>{en ? ({ 'game-zip': 'Game ZIP', 'game-spec': 'GameSpec', report: 'Experiment report' }[item.kind || ''] || 'Attachment') : ({ 'game-zip': '游戏 ZIP', 'game-spec': 'GameSpec', report: '实验报告' }[item.kind || ''] || '附件')}{item.bytes ? ` · ${(item.bytes / 1_000_000).toFixed(2)} MB` : ''}</p>
    <Button loading={busy} onClick={() => void requestLink()}>{en ? 'Prepare Download Link' : '获取下载链接'}</Button>
    {error && <p role="alert">{en ? 'Download access could not be confirmed. Refresh the post or try preparing a new link.' : '暂时无法确认下载权限，请刷新帖子或重新获取链接。'}</p>}
    {link && <>
      <p><a href={link.url} download={link.filename} target="_blank" rel="noopener noreferrer" onClick={() => setOffered(true)}>{en ? 'Download attachment · link valid for 5 minutes' : '下载附件 · 链接有效期 5 分钟'}</a></p>
      {onChecked && <><p>{en ? 'Download and inspect this exact file before confirming. No archive or script is run automatically.' : '下载并检查这份文件后再确认。页面不会自动运行压缩包或脚本。'}</p><p className="community-file-hash">SHA-256: {link.sha256}</p><Checkbox disabled={!offered} checked={checked} onChange={event => { setChecked(event.target.checked); onChecked(event.target.checked) }}>{en ? 'I downloaded and inspected this attachment.' : '我已下载并检查这份附件。'}</Checkbox></>}
    </>}
  </div>
}

function MediaPreview({ postId, item, onLoaded }: { postId: string; item: Media; onLoaded: (id: string, success: boolean) => void }) {
  const locale = useUiLocale()
  const [preview, setPreview] = useState<{ url: string; kind: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => { if (active) { setFailed(true); controller.abort() } }, 15000)
    setFailed(false); setPreview(null)
    void fetch(`/api/community/posts/${postId}/media?mediaId=${item.id}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('preview')
      const data = await response.json()
      const url = new URL(data.url)
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('url')
      if (active) setPreview({ url: url.href, kind: data.kind })
    }).catch(() => { if (active) setFailed(true) }).finally(() => window.clearTimeout(timeout))
    return () => { active = false; window.clearTimeout(timeout); controller.abort() }
  }, [postId, item.id, refresh])
  const error = () => { setFailed(true); onLoaded(item.id, false) }
  return <div className="community-media-item">
    {failed ? <><p>{locale === 'en' ? 'Media could not be loaded. Access may have changed or the link may have expired.' : '媒体未加载成功，可能是权限已变化或链接已过期。'}</p><Button onClick={() => { onLoaded(item.id, false); setRefresh(value => value + 1) }}>{locale === 'en' ? 'Reload Media' : '重新加载媒体'}</Button></>
      : preview?.kind === 'image' ? <img src={preview.url} alt={locale === 'en' ? 'Artwork attached to this post' : '这篇帖子的图片作品'} loading="lazy" onLoad={() => onLoaded(item.id, true)} onError={error} />
        : preview?.kind === 'video' ? <video src={preview.url} controls preload="metadata" onLoadedMetadata={() => onLoaded(item.id, true)} onError={error} />
          : preview?.kind === 'audio' ? <audio src={preview.url} controls preload="metadata" onLoadedMetadata={() => onLoaded(item.id, true)} onError={error} />
            : <Spin size="small" />}
  </div>
}

export default function CommunityMediaGallery({ postId, revision, onReady, onDetach, busy = false }: Props) {
  const locale = useUiLocale()
  const [open, setOpen] = useState(false)
  const [media, setMedia] = useState<Media[] | null>(null)
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const readyCallback = useRef(onReady)
  useEffect(() => { readyCallback.current = onReady }, [onReady])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => { if (active) { setError(true); controller.abort() } }, 15000)
    setMedia(null); setLoaded({}); setError(false)
    void fetch(`/api/community/posts/${postId}/media`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('attachments')
      const data = await response.json()
      if (active) setMedia(data.media)
    }).catch(() => { if (active) setError(true) }).finally(() => window.clearTimeout(timeout))
    return () => { active = false; window.clearTimeout(timeout); controller.abort() }
  }, [postId, revision, open, refresh])
  useEffect(() => {
    const ready = media && !error && media.every(item => item.verified && ['image', 'video', 'audio', 'game-zip', 'game-spec', 'report'].includes(item.kind || '') && loaded[item.id])
    readyCallback.current?.(ready ? media.map(item => item.id) : null)
  }, [media, loaded, error])
  return <details className="community-media-gallery" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{locale === 'en' ? 'View Attached Media' : '查看附带作品'}</summary>
    {open && <div>
      <Button onClick={() => setRefresh(value => value + 1)}>{locale === 'en' ? 'Refresh Media' : '刷新媒体'}</Button>
      {error && <Alert type="warning" showIcon message={locale === 'en' ? 'Attachments are unavailable. No missing media has been marked as reviewed.' : '附件暂时无法读取，未将缺失素材标为已查看。'} />}
      {!media && !error && <Spin size="small" />}
      {media?.map(item => <div key={`${item.id}:${refresh}`}>
        {onDetach && <Popconfirm title={locale === 'en' ? 'Remove this attachment from the draft?' : '从草稿中移除这份附件？'} description={locale === 'en' ? 'The original file will be retained. You can manage unlinked files separately.' : '原文件会保留，未关联文件可另行管理。'} okText={locale === 'en' ? 'Remove Attachment' : '移除附件'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => onDetach(item.id)}><Button danger disabled={busy}>{locale === 'en' ? 'Remove Attachment' : '移除附件'}</Button></Popconfirm>}
        {item.verified && ['image', 'video', 'audio'].includes(item.kind || '')
          ? <><MediaPreview postId={postId} item={item} onLoaded={(id, success) => setLoaded(previous => previous[id] === success ? previous : { ...previous, [id]: success })} />{item.canDownload && <AttachmentDownload postId={postId} item={item} />}</>
          : item.verified && ['game-zip','game-spec','report'].includes(item.kind || '')
            ? <AttachmentDownload postId={postId} item={item} onChecked={onReady ? checked => setLoaded(previous => previous[item.id] === checked ? previous : { ...previous, [item.id]: checked }) : undefined} />
            : <p>{locale === 'en' ? 'This attachment has not been verified.' : '此附件尚未验证。'}</p>}
      </div>)}
      {media?.length === 0 && <p>{locale === 'en' ? 'No media is attached.' : '这篇帖子没有媒体附件。'}</p>}
    </div>}
  </details>
}
