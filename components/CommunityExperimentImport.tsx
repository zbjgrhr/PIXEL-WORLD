'use client'

import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal } from 'antd'
import { useUiLocale } from './ui/LanguageSwitcher'

interface Target { id: string; title: string; language: string; updated_at: string }
interface Props { target: Target | null; configured: boolean; onClose: () => void; onBusy: (busy: boolean) => void; onChanged: () => Promise<void> }
export default function CommunityExperimentImport({ target, configured, onClose, onBusy, onChanged }: Props) {
  const en = useUiLocale() === 'en'
  const [value, setValue] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [media, setMedia] = useState<Array<{ id: string; kind: string; verified: boolean }> | null>(null)
  const lock = useRef(false)
  const readGeneration = useRef(0)
  useEffect(() => {
    readGeneration.current++
    if (!target) return
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 15_000)
    let active = true
    setValue(''); setConfirmed(false); setError(''); setMedia(null); setLoading(true)
    void fetch(`/api/community/posts/${target.id}/media`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('media')
      const data = await response.json()
      if (active) setMedia(data.media)
    }).catch(() => { if (active) setError('LOAD_FAILED') }).finally(() => { window.clearTimeout(timer); if (active) setLoading(false) })
    return () => { active = false; readGeneration.current++; controller.abort(); window.clearTimeout(timer) }
  }, [target?.id])
  const useTemplate = () => {
    if (!target || !media) return
    readGeneration.current++
    const check = () => ({ state: 'not-tested', evidenceIds: [], note: '' })
    setValue(JSON.stringify({ pairId: '', language: target.language, tier: '', outcome: 'partial', title: target.title, story: '', levelCount: 3, projectCommit: 'unknown', dirtyWorktree: true, promptVersion: '', models: { textProvider: '', textModelId: '', imageProvider: '', imageModelId: '' }, timing: [], usage: { budgetUsd: 2, costUsd: null, costSource: 'unknown', calls: null, tokens: null }, fallback: { totalImageTasks: 0, supplementedTasks: 0, items: [] }, checks: { storyFidelity: check(), artQuality: check(), webPlaythrough: check(), offlinePlaythrough: check() }, issues: [], mediaIds: media.map(item => item.id) }, null, 2))
    setConfirmed(false); setError('')
  }
  const send = async () => {
    if (!target || lock.current || !confirmed || !configured) return
    let record
    try { if (new TextEncoder().encode(value).byteLength > 48_000) throw new Error('size'); record = JSON.parse(value.replace(/^\uFEFF/, '')) } catch { setError('CHECK_JSON'); return }
    lock.current = true; setBusy(true); onBusy(true); setError('')
    try {
      const response = await fetch(`/api/community/posts/${target.id}/experiment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: target.updated_at, record }), signal: AbortSignal.timeout(30_000) })
      if (!response.ok) { setError(response.status === 409 ? 'DRAFT_CHANGED' : response.status === 400 ? 'CHECK_RECORD' : 'STATUS_UNKNOWN'); return }
      await onChanged(); onClose()
    } catch { setError('STATUS_UNKNOWN') }
    finally { lock.current = false; setBusy(false); onBusy(false) }
  }
  const messages: Record<string, string> = en ? {
    LOAD_FAILED: 'Attachments could not be checked. Close this window and refresh the post before continuing.', CHECK_JSON: 'Use valid JSON no larger than 48 KB.', DRAFT_CHANGED: 'The draft has changed or already has a record. Close this window and refresh the post list.', CHECK_RECORD: 'Check the required fields, language, exact attachment IDs, evidence references, costs, timings, fallback details and private information.', STATUS_UNKNOWN: 'Import could not be confirmed. Close this window and refresh the post before trying again.',
  } : { LOAD_FAILED: '暂时无法核对附件，请关闭窗口并刷新帖子后再操作。', CHECK_JSON: '请使用有效的 JSON，内容不超过 48 KB。', DRAFT_CHANGED: '草稿已变化或已有关联记录，请关闭窗口并刷新作品列表。', CHECK_RECORD: '请核对必填字段、语言、附件 ID、证据引用、费用、耗时、补齐明细和敏感信息。', STATUS_UNKNOWN: '暂时无法确认导入结果，请关闭窗口并刷新帖子后再操作。' }
  return <Modal title={en ? 'Import Experiment Record · Optional' : '导入实验记录 · 可选'} open={!!target} onCancel={() => { if (!lock.current) onClose() }} closable={!busy} maskClosable={!busy} keyboard={!busy}
    onOk={() => void send()} okText={en ? 'Import into Draft' : '导入草稿'} cancelText={en ? 'Cancel' : '取消'} confirmLoading={busy} cancelButtonProps={{ disabled: busy }} okButtonProps={{ disabled: !configured || !confirmed || !value.trim() || !media || media.some(item => !item.verified) }}>
    <p data-no-ui-translation>{target?.title}</p>
    <Alert type="info" showIcon message={en ? 'Advanced record import. Upload this run’s evidence first. Importing saves an author-reported snapshot; it does not publish the post or approve a template.' : '这是可选的详细记录入口。请先上传该轮证据。导入保存的是作者记录快照，不会自动发布帖子或批准模板。'} />
    {!configured && <p>{en ? 'Experiment import is not configured yet.' : '实验记录导入尚未配置。'}</p>}
    <p>{en ? 'You can still share a normal post without importing a record. Keep unknown values as null; do not replace missing measurements with zero.' : '不导入记录也能正常分享帖子。未知数据保留 null，不要用零代替缺失记录。'}</p>
    {error && <Alert type="error" showIcon message={messages[error]} />}
    <Button loading={loading} disabled={busy || !media || media.some(item => !item.verified)} onClick={useTemplate}>{en ? 'Insert Field Template' : '填入字段模板'}</Button>
    <label className="community-upload-controls">{en ? 'Or choose a JSON record' : '或选择 JSON 记录'}<input type="file" accept=".json,application/json" disabled={busy} onChange={async event => {
      const selected = event.target.files?.[0]
      if (!selected) return
      if (selected.size > 48_000) { setError('CHECK_JSON'); return }
      const generation = ++readGeneration.current
      try { const contents = await selected.text(); if (readGeneration.current === generation) { setValue(contents); setConfirmed(false); setError('') } } catch { if (readGeneration.current === generation) setError('CHECK_JSON') }
      event.target.value = ''
    }} /></label>
    <p>{en ? 'The template contains blank required fields. Enter the real story, tier, model IDs and measurements, and review every default before importing. Evidence IDs refer to the verified attachments below.' : '模板含有待填写字段。请填入真实故事、档位、模型 ID 和实测数据，并核对所有默认值。证据引用使用下方已验证附件 ID。'}</p>
    <p>{en ? 'Allowed values: tier = low / medium / high; outcome = completed / partial / failed; check state = not-tested / passed / failed. A passed check needs evidence IDs. A completed game needs web and offline playthrough evidence, a ZIP, a GameSpec, and no unresolved major issues.' : '取值：tier 为 low / medium / high；outcome 为 completed / partial / failed；检查 state 为 not-tested / passed / failed。通过项需要证据 ID；游戏完成还需网页与离线证据、ZIP、GameSpec，且不能有未解决的严重问题。'}</p>
    {media?.map(item => <p key={item.id} data-no-ui-translation>{item.kind} · {item.id}</p>)}
    <Input.TextArea aria-label={en ? 'Experiment record JSON' : '实验记录 JSON'} rows={12} value={value} disabled={busy} onChange={event => { readGeneration.current++; setValue(event.target.value); setConfirmed(false) }} />
    <Checkbox disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)}>{en ? 'I checked the record, defaults, same-run evidence and private information. The imported record and evidence are fixed snapshots; changed evidence needs a new draft.' : '我已核对记录、默认值、同轮证据和敏感信息。导入后记录及证据固定，修改证据需新建草稿。'}</Checkbox>
  </Modal>
}
