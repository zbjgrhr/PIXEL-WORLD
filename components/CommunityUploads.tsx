'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Popconfirm, Progress, Tag } from 'antd'
import { useUiLocale } from './ui/LanguageSwitcher'
import { communityFileMetadata, transferCommunityFile } from '@/lib/community-upload.client'
import type { CommunitySection } from '@/lib/community-types'

interface Target { id: string; title: string; updated_at: string }
interface Ticket { id: string; original_name: string; state: string; post_id: string | null; failure_code: string | null }
interface Props { target: Target | null; open: boolean; section: CommunitySection; configured: boolean; onClose: () => void; onBusy: (busy: boolean) => void; onChanged: () => Promise<void> }

export default function CommunityUploads({ target, open, section, configured, onClose, onBusy, onChanged }: Props) {
  const en = useUiLocale() === 'en'
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<'idle' | 'reserving' | 'transferring' | 'verifying' | 'cleaning'>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(false)
  const lock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const busy = stage !== 'idle'
  const load = useCallback(async () => {
    const response = await fetch('/api/community/uploads', { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('LOAD_FAILED')
    const data = await response.json()
    setTickets(data.uploads || [])
  }, [])
  useEffect(() => {
    if (!open) return
    setFile(null); setError(''); setNotice(false); setProgress(0)
    void load().catch(() => setError('LOAD_FAILED'))
  }, [open, target?.id, load])
  const changeStage = (next: typeof stage) => { setStage(next); onBusy(next !== 'idle') }
  const send = async () => {
    if (!file || !target || lock.current || !configured) return
    lock.current = true; setError(''); setNotice(false)
    let prepared = false
    try {
      const metadata = communityFileMetadata(file, section)
      prepared = true
      changeStage('reserving')
      const reserve = await fetch('/api/community/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...metadata, postId: target.id, updatedAt: target.updated_at }), signal: AbortSignal.timeout(25_000) })
      const reservation = await reserve.json()
      if (!reserve.ok) throw new Error(reserve.status === 507 ? 'STORAGE_LIMIT' : reserve.status === 409 ? 'DRAFT_CHANGED' : reservation.code === 'UPLOAD_NOT_CONFIGURED' ? 'UPLOAD_NOT_CONFIGURED' : 'RESERVE_FAILED')
      changeStage('transferring'); setProgress(0)
      await transferCommunityFile(file, reservation.upload, setProgress)
      changeStage('verifying')
      const verified = await fetch(`/api/community/uploads/${reservation.upload.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(130_000) })
      const result = await verified.json()
      if (!verified.ok || result.upload?.state !== 'complete') throw new Error(result.code === 'VERIFY_STATUS_UNKNOWN' ? 'VERIFY_STATUS_UNKNOWN' : verified.status === 422 ? 'FILE_REJECTED' : 'VERIFY_FAILED')
      setNotice(true); setFile(null); if (input.current) input.current.value = ''
      await onChanged()
    } catch (issue) {
      const code = issue instanceof Error ? issue.message : ''
      setError(['STORAGE_LIMIT','DRAFT_CHANGED','UPLOAD_NOT_CONFIGURED','RESERVE_FAILED','TRANSFER_FAILED','SIGN_IN_REQUIRED','VERIFY_STATUS_UNKNOWN','FILE_REJECTED','VERIFY_FAILED'].includes(code) ? code : !prepared ? 'CHECK_FILE' : 'STATUS_UNKNOWN')
    } finally {
      await load().catch(() => setError(previous => previous || 'LOAD_FAILED'))
      lock.current = false; changeStage('idle')
    }
  }
  const clean = async (ticket: Ticket) => {
    if (lock.current) return
    lock.current = true; changeStage('cleaning'); setError(''); setNotice(false)
    try {
      const response = await fetch(`/api/community/uploads/${ticket.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(90_000) })
      if (!response.ok) throw new Error('CLEANUP_FAILED')
      await load()
    } catch { setError('CLEANUP_FAILED') }
    finally { lock.current = false; changeStage('idle') }
  }
  const messages: Record<string, string> = en ? {
    LOAD_FAILED: 'Upload records could not be loaded. Refresh them before continuing.', CHECK_FILE: 'Choose a supported file no larger than 45 MB. Artwork accepts images, video and audio.',
    STORAGE_LIMIT: 'Available storage or the pending-upload limit has been reached. Review unfinished uploads first.', DRAFT_CHANGED: 'This draft has changed. Close this window and refresh the post list before uploading.',
    UPLOAD_NOT_CONFIGURED: 'File uploads are not configured yet.', RESERVE_FAILED: 'The upload could not be prepared. Check your sign-in, draft and pending uploads.', TRANSFER_FAILED: 'Transfer did not finish. No automatic retry was made. Check the upload records and remove the unfinished upload before trying again.',
    SIGN_IN_REQUIRED: 'Sign in again before uploading.', VERIFY_STATUS_UNKNOWN: 'Verification could not be confirmed. Refresh the records; do not upload the same file again yet.',
    FILE_REJECTED: 'The file did not pass content checks and was not attached. Your local original is unchanged. Check for pending cleanup below.', VERIFY_FAILED: 'Verification did not finish. Check the upload records before trying again.',
    STATUS_UNKNOWN: 'The operation could not be confirmed. Refresh the records before taking another action.', CLEANUP_FAILED: 'Cleanup was not confirmed. Storage remains reserved; refresh and check the record.',
  } : {
    LOAD_FAILED: '上传记录暂时无法加载，请先刷新记录。', CHECK_FILE: '请选择支持的文件，单个不超过 45 MB。艺术作品仅接受图片、视频和音频。',
    STORAGE_LIMIT: '可用空间或待完成上传数量已达上限，请先检查未完成的上传。', DRAFT_CHANGED: '草稿已变化，请关闭窗口并刷新作品列表后再上传。',
    UPLOAD_NOT_CONFIGURED: '文件上传尚未配置。', RESERVE_FAILED: '未能准备上传，请检查登录状态、草稿和未完成的上传。', TRANSFER_FAILED: '文件传输未完成，系统没有自动重试。请查看记录，清理未完成的上传后再试。',
    SIGN_IN_REQUIRED: '请重新登录后上传。', VERIFY_STATUS_UNKNOWN: '暂时无法确认校验结果。请刷新记录，先不要重复上传同一个文件。',
    FILE_REJECTED: '文件未通过内容检查，没有加入帖子。本地原文件未改动，请查看下方是否需要清理。', VERIFY_FAILED: '校验未完成，请先检查上传记录再操作。',
    STATUS_UNKNOWN: '暂时无法确认操作结果，请先刷新上传记录。', CLEANUP_FAILED: '暂时无法确认清理完成，预留空间仍保留，请刷新检查。',
  }
  const pending = tickets.filter(ticket => !['failed','deleted'].includes(ticket.state) && (ticket.state !== 'complete' || !ticket.post_id))
  return <Modal title={en ? 'Post Attachments' : '帖子附件'} open={open} onCancel={() => { if (!lock.current) onClose() }} footer={null} closable={!busy} maskClosable={!busy} keyboard={!busy}>
    {target && <p data-no-ui-translation>{target.title}</p>}
    {!configured && <Alert type="info" showIcon message={en ? 'File uploads are not configured yet.' : '文件上传尚未配置。'} />}
    <p>{en ? 'Files are added to a saved draft after content checks. A verified file has not yet passed publication review. Maximum file size: 45 MB.' : '文件通过内容检查后加入已保存的草稿。文件校验通过不代表作品审核通过。单个文件不超过 45 MB。'}</p>
    {error && <Alert type="error" showIcon message={messages[error] || messages.STATUS_UNKNOWN} />}
    {notice && <Alert type="success" showIcon message={en ? 'File verified and attached. Close this window to review the updated draft.' : '文件已通过校验并加入草稿。关闭窗口后可查看更新后的帖子。'} />}
    {target && !notice && <div className="community-upload-controls">
      <label>{en ? 'Choose an attachment' : '选择附件'}<input ref={input} type="file" disabled={busy || !configured} accept={section === 'art' ? '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.ogg' : '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mp3,.wav,.ogg,.zip,.json,.md,.txt,.log'} onChange={event => { setFile(event.target.files?.[0] || null); setError('') }} /></label>
      <Button type="primary" disabled={!file || busy || !configured} loading={busy} onClick={() => void send()}>{en ? 'Upload and Verify' : '上传并校验'}</Button>
    </div>}
    {busy && <p role="status">{en ? ({ reserving: 'Preparing upload…', transferring: 'Transferring file…', verifying: 'Checking file contents…', cleaning: 'Removing the cloud copy…', idle: '' }[stage]) : ({ reserving: '正在准备上传…', transferring: '正在传输文件…', verifying: '正在检查文件内容…', cleaning: '正在清理云端文件…', idle: '' }[stage])}</p>}
    {stage === 'transferring' && <Progress percent={progress} />}
    <h3>{en ? 'Pending Uploads and Retained Files' : '待处理上传与保留文件'}</h3>
    <Button disabled={busy} onClick={() => { void load().then(async () => { await onChanged(); setError('') }).catch(() => setError('LOAD_FAILED')) }}>{en ? 'Refresh Records' : '刷新记录'}</Button>
    <p>{en ? 'No automatic retries are made. Cleanup removes an unlinked cloud copy; your local original is retained. First remove files from any posts and from your profile avatar before deleting them.' : '系统不会自动重试。清理会删除未关联的云端文件，本地原文件不变。文件仍被帖子或头像使用时，需先解除关联才能删除。'}</p>
    {pending.map(ticket => <div key={ticket.id} className="community-upload-record">
      <span data-no-ui-translation>{ticket.original_name}</span><Tag>{en ? ({ reserved: 'Awaiting transfer', verifying: 'Verification unconfirmed', deleting: 'Cleanup pending', complete: 'Retained file' }[ticket.state] || 'Check status') : ({ reserved: '待传输或校验', verifying: '校验结果待确认', deleting: '待清理', complete: '保留文件' }[ticket.state] || '待检查')}</Tag>
      <Popconfirm title={en ? 'Remove this cloud copy?' : '删除这份云端文件？'} description={en ? 'Check the file and verification status first. Your local original is retained; files still used by posts cannot be removed.' : '请先确认文件和校验状态。本地原文件保留，仍被帖子使用的文件不能删除。'} okText={en ? 'Remove Cloud Copy' : '删除云端文件'} cancelText={en ? 'Cancel' : '取消'} onConfirm={() => clean(ticket)}><Button danger disabled={busy || !configured}>{en ? 'Remove Cloud Copy' : '清理云端文件'}</Button></Popconfirm>
    </div>)}
    {!pending.length && <p>{en ? 'No unfinished uploads in the latest records.' : '最近的记录中没有未完成的上传。'}</p>}
    <h3>{en ? 'Recent Verified Attachments' : '最近校验通过的附件'}</h3>
    {tickets.filter(ticket => ticket.state === 'complete' && ticket.post_id).map(ticket => <div key={ticket.id} className="community-upload-record"><span data-no-ui-translation>{ticket.original_name}</span><Tag color="green">{en ? 'Attached · not publication approval' : '已加入帖子 · 不代表审核通过'}</Tag></div>)}
  </Modal>
}
