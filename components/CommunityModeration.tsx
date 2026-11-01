'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Input, Popconfirm, Spin, Tag } from 'antd'
import LanguageSwitcher, { useUiLocale } from './ui/LanguageSwitcher'
import CommunityMediaGallery from './CommunityMediaGallery'
import CommunityExperimentDetails from './CommunityExperimentDetails'

interface Post { id: string; title: string; description: string; language: string; section: string; rights: string; license_note: string; reuse: string; moderation: string; updated_at: string; experiment_id?: string | null; art_kind?: string; linked_game_id?: string | null; linked_game?: { id: string; title: string } | null; attachments?: { media_id: string }[] }
interface Report { id: string; post_id: string; reason: string; status: string; post: Post | null }

export default function CommunityModeration() {
  const locale = useUiLocale()
  const [queue, setQueue] = useState<{ posts: Post[]; reports: Report[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [unconfigured, setUnconfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [mediaReady, setMediaReady] = useState<Record<string, string[] | null>>({})
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({})
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setUnconfigured(false)
    try {
      const response = await fetch('/api/community/moderation', { cache: 'no-store', signal })
      if (response.status === 401 || response.status === 403) { setQueue(null); setError('请使用有审核权限的账号登录。'); return }
      if (response.status === 503) {
        const detail = await response.json()
        if (detail.code === 'COMMUNITY_NOT_CONFIGURED') { setQueue(null); setUnconfigured(true); return }
      }
      if (!response.ok) throw new Error('queue')
      const data = await response.json()
      if (!signal?.aborted) setQueue(data)
    } catch { if (!signal?.aborted) { setQueue(null); setError('审核队列暂时不可用，请检查服务配置后重试。') } }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [])
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [load])

  const decide = async (kind: 'post' | 'report', id: string, action: string, version: string, reasonKey: string, reviewedMediaIds: string[] = []) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch('/api/community/moderation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id, action, version, reason: reasons[reasonKey] || '', reviewedMediaIds, reviewConfirmed: confirmed[`${id}:${version}`] === true }) })
      if (response.status === 409) { setError('内容已更新，本次决定未保存。请刷新队列后重新检查。'); return }
      if (!response.ok) throw new Error('review')
      setReasons(previous => { const next = { ...previous }; delete next[reasonKey]; return next })
      setNotice('审核决定已保存。'); await load()
    } catch { setError('审核决定未保存，请检查说明和权限后重试。') }
    finally { setBusy(false) }
  }
  const reasonField = (key: string) => <Input.TextArea disabled={busy} aria-label={locale === 'en' ? 'Review rationale' : '审核说明'} placeholder={locale === 'en' ? 'Record what you checked and explain the decision.' : '记录检查内容，并说明处理理由。'} rows={3} maxLength={2000} value={reasons[key] || ''} onChange={event => setReasons(previous => ({ ...previous, [key]: event.target.value }))} />
  const postContent = (post: Post) => <>
    <div><Tag>{post.section === 'art' ? (locale === 'en' ? 'Artwork' : '艺术作品') : (locale === 'en' ? 'Creative Workshop' : '创意工坊')}</Tag><Tag>{post.language === 'en' ? 'English' : '简体中文'}</Tag></div>
    <div data-no-ui-translation><h3>{post.title}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{post.description}</p></div>
    {post.section === 'art' && <>
      <p>{locale === 'en' ? 'Artwork category: ' : '作品类型：'}{locale === 'en' ? ({ character: 'Characters', scene: 'Scenes', effect: 'Effects', screenshot: 'Screenshots', video: 'Video', audio: 'Audio', other: 'Other' }[post.art_kind || 'other']) : ({ character: '角色', scene: '场景', effect: '特效', screenshot: '截图', video: '视频', audio: '音频', other: '其他' }[post.art_kind || 'other'])}</p>
      {post.linked_game_id && <p>{locale === 'en' ? 'Related game: ' : '关联游戏：'}{post.linked_game ? <a href={`/community?game=${post.linked_game.id}`} target="_blank" rel="noopener noreferrer" data-no-ui-translation>{post.linked_game.title}</a> : (locale === 'en' ? 'Not currently available' : '暂不可见')}</p>}
    </>}
    {post.experiment_id && <CommunityExperimentDetails key={`record:${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} />}
    <p>{locale === 'en' ? 'Source / reuse permission' : '内容来源 / 复用权限'}：{locale === 'en' ? ({ original: 'Original work', 'ai-generated': 'AI-generated', licensed: 'Used with permission' }[post.rights] || post.rights) : ({ original: '原创', 'ai-generated': 'AI 生成', licensed: '已获授权' }[post.rights] || post.rights)} / {locale === 'en' ? ({ 'view-only': 'Viewing only', download: 'Download permitted', 'remix-with-credit': 'Adaptation permitted with attribution' }[post.reuse] || post.reuse) : ({ 'view-only': '仅展示', download: '允许下载', 'remix-with-credit': '署名后可改编' }[post.reuse] || post.reuse)}</p>
    {post.license_note && <p data-no-ui-translation>{post.license_note}</p>}
    {post.attachments?.length ? <CommunityMediaGallery key={`${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} onReady={ids => {
      const key = `${post.id}:${post.updated_at}`, next = ids?.slice().sort() ?? null
      setMediaReady(previous => JSON.stringify(previous[key] ?? null) === JSON.stringify(next) ? previous : { ...previous, [key]: next })
      if (!next) setConfirmed(previous => previous[key] ? { ...previous, [key]: false } : previous)
    }} /> : null}
  </>
  return <main className="community-shell">
    <header className="community-header"><Link href="/community">← 返回玩家社区</Link><h1>社区审核</h1><LanguageSwitcher /></header>
    <section className="community-content">
      <p>发布前核对内容来源、授权、敏感信息，以及实验状态与证据是否相符。文字审核通过不代表游戏已通关或已入选模板。</p>
      <p>{locale === 'en' ? 'Inspect images, play audiovisual media, and download and check ZIP files, specifications and reports before confirming. Loading a link does not complete a review.' : '请逐项查看图片、播放影音，并下载检查 ZIP、规格和报告，再勾选审核确认。获取链接不代表完成检查。'}</p>
      <Button disabled={busy || loading} onClick={() => void load()}>刷新队列</Button>
      {unconfigured && <Alert type="info" showIcon message="玩家社区尚未配置。制作和离线导出仍可正常使用。" />}
      {error && <Alert type="error" showIcon message={error} />}{notice && <Alert type="success" showIcon message={notice} />}
      <Spin spinning={loading}>{queue && <>
        <h2>待审作品</h2><p>每次最多显示 20 项，处理后刷新可查看后续内容。</p>
        <div className="workshop-grid">{queue.posts.map(post => <article className="workshop-card community-composer" key={post.id}>
          {postContent(post)}{reasonField(`post:${post.id}`)}
          <Checkbox disabled={busy || (!!post.attachments?.length && !mediaReady[`${post.id}:${post.updated_at}`])} checked={!!confirmed[`${post.id}:${post.updated_at}`]} onChange={event => setConfirmed(previous => ({ ...previous, [`${post.id}:${post.updated_at}`]: event.target.checked }))}>{locale === 'en' ? 'I have reviewed the content, permissions, and all attached media.' : '我已检查内容、授权和全部媒体附件。'}</Checkbox>
          <div className="community-toolbar">
            <Popconfirm title={locale === 'en' ? 'Approve and publish this post?' : '审核通过并公开这篇帖子？'} okText={locale === 'en' ? 'Publish' : '公开'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => decide('post', post.id, 'approve', post.updated_at, `post:${post.id}`, mediaReady[`${post.id}:${post.updated_at}`] || [])}>
              <Button type="primary" disabled={busy || !reasons[`post:${post.id}`]?.trim() || !confirmed[`${post.id}:${post.updated_at}`]}>通过并公开</Button>
            </Popconfirm>
            <Button disabled={busy || !reasons[`post:${post.id}`]?.trim()} onClick={() => void decide('post', post.id, 'reject', post.updated_at, `post:${post.id}`)}>退回修改</Button>
          </div>
        </article>)}</div>{!queue.posts.length && <p>暂无待审作品。</p>}
        <h2>待处理举报</h2><p>标记举报已处理不会自动下架帖子；需要下架时，请先单独操作。</p>
        <div className="workshop-grid">{queue.reports.map(report => <article className="workshop-card community-composer" key={report.id}>
          {report.post && postContent(report.post)}<p data-no-ui-translation>{report.reason}</p>{reasonField(`report:${report.id}`)}
          <div className="community-toolbar">
            {report.post?.moderation === 'published' && <Popconfirm title={locale === 'en' ? 'Remove this post from public view?' : '将这篇帖子从公开列表下架？'} okText={locale === 'en' ? 'Remove' : '下架'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => decide('post', report.post!.id, 'hide', report.post!.updated_at, `report:${report.id}`)}>
              <Button danger disabled={busy || !reasons[`report:${report.id}`]?.trim()}>下架帖子</Button>
            </Popconfirm>}
            <Button disabled={busy || !reasons[`report:${report.id}`]?.trim()} onClick={() => void decide('report', report.id, 'resolve', report.status, `report:${report.id}`)}>标记已处理</Button>
            <Button disabled={busy || !reasons[`report:${report.id}`]?.trim()} onClick={() => void decide('report', report.id, 'dismiss', report.status, `report:${report.id}`)}>不采纳举报</Button>
          </div>
        </article>)}</div>{!queue.reports.length && <p>暂无待处理举报。</p>}
      </>}</Spin>
    </section>
  </main>
}
