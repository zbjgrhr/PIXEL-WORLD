'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Popconfirm, Select, Segmented, Spin, Tag } from 'antd'
import LanguageSwitcher, { useUiLocale } from './ui/LanguageSwitcher'
import { communityBrowserClient } from '@/lib/supabase/client'
import type { CommunitySection } from '@/lib/community-types'
import { ARTWORK_KINDS, type ArtworkKind } from '@/lib/community-types'
import CommunityMediaGallery from './CommunityMediaGallery'
import CommunityUploads from './CommunityUploads'
import CommunityExperimentDetails from './CommunityExperimentDetails'
import CommunityExperimentImport from './CommunityExperimentImport'
import CommunityProfile from './CommunityProfile'
import CommunityAuthor from './CommunityAuthor'
import CommunityTemplateReview from './CommunityTemplateReview'
import CommunityGamePreview from './CommunityGamePreview'
import type { PublicAuthor } from '@/lib/community-profile'

interface Post { id: string; owner_id: string; title: string; description: string; language: string; moderation: string; created_at: string; updated_at: string; rights: string; license_note: string; reuse: string; experiment_id: string | null; art_kind?: ArtworkKind; linked_game_id?: string | null; linked_game?: { id: string; title: string; language: string } | null; attachments?: { media_id: string }[] }
interface Report { id: string; post_id: string; status: 'open' | 'resolved' | 'dismissed'; created_at: string }

export default function CommunityPortal() {
  const locale = useUiLocale()
  const artLabel = (kind: ArtworkKind) => locale === 'en' ? ({ character: 'Characters', scene: 'Scenes', effect: 'Effects', screenshot: 'Screenshots', video: 'Video', audio: 'Audio', other: 'Other' }[kind]) : ({ character: '角色', scene: '场景', effect: '特效', screenshot: '截图', video: '视频', audio: '音频', other: '其他' }[kind])
  const [session, setSession] = useState<{ configured: boolean; user: { id: string } | null; moderator?: boolean; uploadsConfigured?: boolean } | null>(null)
  const [uploadsOpen, setUploadsOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [uploadTarget, setUploadTarget] = useState<Post | null>(null)
  const [experimentTarget, setExperimentTarget] = useState<Post | null>(null)
  const [section, setSection] = useState<CommunitySection>('workshop')
  const [mine, setMine] = useState(false)
  const [artKind, setArtKind] = useState<ArtworkKind>('other')
  const [artFilter, setArtFilter] = useState('')
  const [gameFilter, setGameFilter] = useState('')
  const [linkedGameId, setLinkedGameId] = useState<string | null>(null)
  const [gameSearch, setGameSearch] = useState('')
  const [gameChoices, setGameChoices] = useState<Array<{ id: string; title: string }>>([])
  const [gamesLoading, setGamesLoading] = useState(false)
  const [gamesError, setGamesError] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [rights, setRights] = useState('ai-generated')
  const [reuse, setReuse] = useState('view-only')
  const [licenseNote, setLicenseNote] = useState('')
  const [language, setLanguage] = useState('zh-CN')
  const [editing, setEditing] = useState<Post | null>(null)
  const [reportTarget, setReportTarget] = useState<Post | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportError, setReportError] = useState('')
  const [reports, setReports] = useState<Report[]>([])
  const [reportRefresh, setReportRefresh] = useState(0)
  const requestSequence = useRef(0)
  const clearComposer = useCallback(() => { setEditing(null); setTitle(''); setDescription(''); setLicenseNote(''); setRights('ai-generated'); setReuse('view-only'); setLanguage('zh-CN'); setArtKind('other'); setLinkedGameId(null); setGameSearch('') }, [])
  const client = useMemo(() => { try { return communityBrowserClient() } catch { return null } }, [])
  const refreshSession = useCallback(async () => {
    const response = await fetch('/api/community/session', { cache: 'no-store' })
    const result = await response.json()
    if (!response.ok) throw new Error('session')
    setSession(result)
  }, [])
  useEffect(() => {
    const game = new URLSearchParams(window.location.search).get('game')
    if (game && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(game)) setGameFilter(game)
    void refreshSession().catch(() => setError('社区连接失败，请稍后重试。'))
    const subscription = client?.auth.onAuthStateChange(() => { void refreshSession().catch(() => setError('社区连接失败，请稍后重试。')) })
    if (new URLSearchParams(window.location.search).has('authError')) setError('登录未完成，请重新登录。')
    return () => subscription?.data.subscription.unsubscribe()
  }, [client, refreshSession])

  const loadPosts = useCallback(async () => {
    if (!session?.configured) return
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const query = new URLSearchParams({ section, mine: mine ? '1' : '0' })
      if (section === 'art' && artFilter) query.set('artKind', artFilter)
      if (section === 'workshop' && gameFilter) query.set('gameId', gameFilter)
      const response = await fetch(`/api/community/posts?${query}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error('posts')
      if (sequence === requestSequence.current) setPosts(data.posts)
    } catch { if (sequence === requestSequence.current) setError('作品加载失败，已保留你的输入。') }
    finally { if (sequence === requestSequence.current) setLoading(false) }
  }, [session?.configured, session?.user?.id, section, mine, artFilter, gameFilter])
  useEffect(() => { setPosts([]); void loadPosts(); return () => { requestSequence.current++ } }, [loadPosts])
  useEffect(() => { if (session && !session.user) setMine(false) }, [session])
  useEffect(() => { clearComposer(); setUploadsOpen(false); setUploadTarget(null); setExperimentTarget(null) }, [session?.user?.id, clearComposer])
  useEffect(() => {
    if (section !== 'art' || !session?.user || !session.configured) { setGameChoices([]); setGamesLoading(false); setGamesError(false); return }
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(() => {
      setGamesLoading(true); setGamesError(false)
      const timeout = window.setTimeout(() => controller.abort(), 15_000)
      void fetch(`/api/community/posts?section=workshop&search=${encodeURIComponent(gameSearch.trim())}`, { cache: 'no-store', signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error('games')
        const data = await response.json()
        if (active) setGameChoices(previous => [...data.posts.map((post: Post) => ({ id: post.id, title: post.title })), ...previous.filter(item => item.id === linkedGameId && !data.posts.some((post: Post) => post.id === item.id))])
      }).catch(() => { if (active) setGamesError(true) }).finally(() => { window.clearTimeout(timeout); if (active) setGamesLoading(false) })
    }, 300)
    return () => { active = false; window.clearTimeout(timer); controller.abort() }
  }, [section, session?.user?.id, session?.configured, gameSearch, linkedGameId])
  useEffect(() => {
    let active = true
    setReports([]); setReportTarget(null); setReportReason(''); setReportError('')
    if (session?.user && session.configured) void fetch('/api/community/reports', { cache: 'no-store' }).then(async response => {
      if (!response.ok) throw new Error('reports')
      const data = await response.json()
      if (active) setReports(data.reports)
    }).catch(() => { if (active) setError('举报记录暂时无法加载，请稍后刷新。') })
    return () => { active = false }
  }, [session?.user?.id, session?.configured, reportRefresh])

  const signIn = async () => {
    if (!client) return
    setBusy(true); setError('')
    try {
      const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: `${location.origin}/auth/callback` } })
      if (error) throw error
    } catch { setError('登录未完成，请重新登录。') }
    finally { setBusy(false) }
  }
  const signOut = async () => {
    if (!client) return
    setBusy(true)
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
      setMine(false); setPosts([]); clearComposer(); await refreshSession()
    } catch { setError('退出登录失败，请重试。') }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(editing ? `/api/community/posts/${editing.id}` : '/api/community/posts', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        section, language, title, description, rights, licenseNote, experimentId: null, mediaIds: [], reuse, updatedAt: editing?.updated_at,
        artKind: section === 'art' ? artKind : 'other', linkedGameId: section === 'art' ? linkedGameId : null,
      }) })
      if (response.status === 409) { setError('作品已在其他页面更新。请先取消编辑并刷新列表，当前输入已保留。'); return }
      if (!response.ok) throw new Error('save')
      const result = await response.json()
      clearComposer(); setMine(true); if (section === 'art') setArtFilter('')
      setNotice(result.post.moderation === 'draft' ? '草稿已保存，尚未公开发布。' : '修改已保存，需要重新审核后公开。')
      if (mine) await loadPosts()
    } catch { setError('草稿保存失败，请检查输入、授权说明及敏感信息。输入已保留。') }
    finally { setBusy(false) }
  }

  const edit = (post: Post) => {
    setEditing(post); setTitle(post.title); setDescription(post.description); setRights(post.rights)
    setLicenseNote(post.license_note); setLanguage(post.language); setReuse(post.reuse); setError(''); setNotice('')
    setArtKind(post.art_kind || 'other'); setLinkedGameId(post.linked_game_id || null); setGameSearch('')
    if (post.linked_game) setGameChoices(previous => previous.some(item => item.id === post.linked_game!.id) ? previous : [...previous, { id: post.linked_game!.id, title: post.linked_game!.title }])
    document.getElementById('community-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const remove = async (post: Post) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/community/posts/${post.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: post.updated_at }) })
      if (response.status === 409) { setError('作品已更新，未删除。请刷新列表后确认。'); return }
      if (!response.ok) throw new Error('delete')
      if (editing?.id === post.id) clearComposer()
      setNotice('帖子已删除。原游戏和素材文件未删除。'); await loadPosts()
    } catch { setError('删除失败，帖子仍保留，请稍后重试。') }
    finally { setBusy(false) }
  }
  const submitReport = async () => {
    if (!reportTarget) return
    setBusy(true); setReportError('')
    try {
      const response = await fetch('/api/community/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postId: reportTarget.id, reason: reportReason }) })
      if (response.status === 409) { setReportError('你已举报过这篇帖子，请勿重复提交。'); return }
      if (!response.ok) throw new Error('report')
      const data = await response.json()
      setReports(previous => [...previous.filter(item => item.post_id !== reportTarget.id), data.report])
      setReportTarget(null); setReportReason(''); setNotice('举报已提交，等待审核处理。')
    } catch { setReportError('举报未提交。请检查说明、移除敏感信息后再试，输入已保留。') }
    finally { setBusy(false) }
  }
  const submitForReview = async (post: Post) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/community/posts/${post.id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ updatedAt: post.updated_at }) })
      if (response.status === 409) { setError('作品已更新或已提交，请刷新列表后检查。'); return }
      if (!response.ok) throw new Error('submission')
      setNotice('作品已提交审核，通过后才会公开。'); await loadPosts()
    } catch { setError('提交审核未完成，请检查作品、素材及服务配置。帖子已保留。') }
    finally { setBusy(false) }
  }
  const revise = async (post: Post, action: 'withdraw' | 'detach', mediaId?: string) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const response = await fetch(`/api/community/posts/${post.id}/revision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, mediaId, updatedAt: post.updated_at }), signal: AbortSignal.timeout(25_000) })
      if (response.status === 409) { setError(locale === 'en' ? 'The post has changed. Refresh the list before revising it.' : '帖子已变化，请刷新列表后再修改。'); return }
      if (!response.ok) throw new Error('revision')
      setNotice(action === 'withdraw' ? (locale === 'en' ? 'The post is now a private draft. Existing files are retained; submit it again after making changes.' : '帖子已转为私有草稿，原附件保留。修改后需重新提交审核。') : (locale === 'en' ? 'Attachment removed from this draft. The original file is retained; unlinked files can be managed separately.' : '已从草稿移除附件，原文件保留。未关联文件可在“管理上传”中另行清理。'))
      await loadPosts()
    } catch { setError(locale === 'en' ? 'The revision could not be confirmed. Refresh the list before taking another action.' : '暂时无法确认修改结果，请刷新列表后再操作。') }
    finally { setBusy(false) }
  }

  return <main className="community-shell">
    <header className="community-header"><Link href="/">← 返回制作台</Link><h1>玩家社区</h1><LanguageSwitcher /></header>
    <div className="community-content">
      <div className="community-toolbar">
        <Segmented disabled={busy || !!editing} aria-label="社区板块" value={section} onChange={value => { setSection(value as CommunitySection); setNotice('') }} options={[{ value: 'workshop', label: locale === 'en' ? 'Creative Workshop' : '创意工坊' }, { value: 'art', label: locale === 'en' ? 'Artwork' : '艺术作品' }]} />
        <div>{session?.moderator && <Link href="/community/moderation">社区审核</Link>}{session?.user && <Button disabled={busy} onClick={()=>setProfileOpen(true)}>{locale==='en'?'Author Profile':'作者资料'}</Button>}{session?.user ? <Button disabled={busy} onClick={signOut}>退出登录</Button> : <Button disabled={!session?.configured || !client} loading={busy} onClick={signIn}>使用 GitHub 登录</Button>}</div>
      </div>
      <p>{section === 'workshop' ? '分享游戏与实验。成功、部分完成和失败，都值得记录。' : '分享角色、场景、特效、游戏截图和影音作品。'}</p>
      {section === 'art' && <Select aria-label={locale === 'en' ? 'Filter artwork by category' : '按类型筛选艺术作品'} disabled={busy || !!editing} value={artFilter} onChange={setArtFilter} options={[{ value: '', label: locale === 'en' ? 'All artwork types' : '全部作品类型' }, ...ARTWORK_KINDS.map(kind => ({ value: kind, label: artLabel(kind) }))]} />}
      {section === 'workshop' && gameFilter && <Alert type="info" showIcon message={locale === 'en' ? 'Showing the linked game if it is still available.' : '正在查看关联游戏；未公开或已移除的内容不会显示。'} action={<Button onClick={() => { setGameFilter(''); const url = new URL(window.location.href); url.searchParams.delete('game'); window.history.replaceState(null,'',url) }}>{locale === 'en' ? 'View All Games' : '查看全部游戏'}</Button>} />}
      {error && <Alert type="error" message={error} showIcon />}
      {notice && <Alert type="success" message={notice} showIcon />}
      {session && !session.configured && <Alert type="info" showIcon message="玩家社区尚未配置。制作和离线导出仍可正常使用。" />}
      {session?.user && <section id="community-composer" className="community-composer">
        <h2>{editing ? '编辑作品' : '写一篇作品草稿'}</h2>
        {editing && <p>已公开的内容修改后需要重新审核。</p>}
        <p>{locale === 'en' ? 'Save a draft first, then add attachments from My Posts and Drafts. Artwork requires verified media before submission.' : '先保存草稿，再到“我的作品与草稿”添加附件。艺术作品需附上已验证的媒体文件才能提交审核。'}</p>
        <Input disabled={busy} aria-label="作品标题" placeholder="作品标题" maxLength={120} value={title} onChange={event => setTitle(event.target.value)} />
        <Input.TextArea disabled={busy} aria-label="作品介绍与已知问题" placeholder="作品介绍与已知问题" maxLength={10000} rows={5} value={description} onChange={event => setDescription(event.target.value)} />
        <Select disabled={busy || !!editing?.experiment_id} aria-label="作品语言" value={language} onChange={setLanguage} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} />
        <Select disabled={busy} aria-label="内容来源" value={rights} onChange={setRights} options={[{ value: 'original', label: locale === 'en' ? 'Original work' : '原创' }, { value: 'ai-generated', label: locale === 'en' ? 'AI-generated' : 'AI 生成' }, { value: 'licensed', label: locale === 'en' ? 'Used with permission' : '已获授权' }]} />
        <Select disabled={busy} aria-label={locale === 'en' ? 'Reuse permission' : '复用权限'} value={reuse} onChange={setReuse} options={[{ value: 'view-only', label: locale === 'en' ? 'Viewing only' : '仅展示' }, { value: 'download', label: locale === 'en' ? 'Download permitted' : '允许下载' }, { value: 'remix-with-credit', label: locale === 'en' ? 'Adaptation permitted with attribution' : '署名后可改编' }]} />
        {section === 'art' && <>
          <Select disabled={busy} aria-label={locale === 'en' ? 'Artwork category' : '艺术作品类型'} value={artKind} onChange={setArtKind} options={ARTWORK_KINDS.map(kind => ({ value: kind, label: artLabel(kind) }))} />
          <Select disabled={busy} allowClear showSearch filterOption={false} loading={gamesLoading} aria-label={locale === 'en' ? 'Related published game (optional)' : '关联已发布游戏（可选）'} placeholder={locale === 'en' ? 'Search published games by title (optional)' : '搜索已发布游戏名称（可选）'} value={linkedGameId} onSearch={value => setGameSearch(value.slice(0,80))} onChange={value => setLinkedGameId(value || null)} options={[...gameChoices.map(game => ({ value: game.id, label: game.title })), ...(linkedGameId && !gameChoices.some(game => game.id === linkedGameId) ? [{ value: linkedGameId, label: locale === 'en' ? 'Previously linked game (unavailable)' : '原关联游戏（暂不可用）' }] : [])]} />
          {gamesError && <p>{locale === 'en' ? 'Published games could not be loaded. You can leave this field empty and post the artwork on its own.' : '暂时无法加载已发布游戏。可以不关联，单独发布艺术作品。'}</p>}
          <p>{locale === 'en' ? 'A related-game link provides context; it does not transfer ownership or grant permission to reuse files.' : '关联游戏只用于说明作品背景，不代表拥有该游戏，也不自动获得素材使用许可。'}</p>
        </>}
        {rights === 'licensed' && <Input disabled={busy} aria-label="授权说明" placeholder="授权说明" value={licenseNote} maxLength={2000} onChange={event => setLicenseNote(event.target.value)} />}
        <Button type="primary" loading={busy} disabled={!title.trim() || !description.trim() || rights === 'licensed' && !licenseNote.trim()} onClick={save}>{editing ? '保存修改' : '保存草稿'}</Button>
        {editing && <Button disabled={busy} onClick={clearComposer}>取消编辑</Button>}
      </section>}
      {session?.configured && <>
        <div className="community-toolbar"><h2>{mine ? '我的作品与草稿' : '玩家作品'}</h2><div>{session.user && <Button disabled={busy || !!editing} onClick={() => { setUploadTarget(null); setUploadsOpen(true) }}>{locale === 'en' ? 'Manage Uploads' : '管理上传'}</Button>}<Button disabled={loading || busy} onClick={() => { void loadPosts(); setReportRefresh(value => value + 1) }}>刷新列表</Button>{session.user && <Button disabled={busy || !!editing} onClick={() => setMine(value => !value)}>{mine ? '查看公开作品' : '查看我的草稿'}</Button>}</div></div>
        <Spin spinning={loading}><div className="workshop-grid">{posts.map(post => <article key={post.id} className="workshop-card" data-no-ui-translation>
          <Tag>{post.language === 'en' ? 'English' : '简体中文'}</Tag><Tag>{locale === 'en' ? ({ published: 'Published', pending: 'Awaiting Review', rejected: 'Changes Requested', draft: 'Draft' }[post.moderation] || 'Not published') : ({ published: '已发布', pending: '待审核', rejected: '退回修改', draft: '草稿' }[post.moderation] || '未公开')}</Tag>
          <CommunityAuthor author={(post as Post & {author?:PublicAuthor}).author || {id:post.owner_id,displayName:null,isOfficial:false,avatarUrl:null}} />
          <h3>{post.title}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{post.description}</p>
          {section === 'art' && <><Tag>{artLabel(post.art_kind || 'other')}</Tag>{post.linked_game_id && (post.linked_game ? <p>{locale === 'en' ? 'Related game: ' : '关联游戏：'}<a href={`/community?game=${post.linked_game.id}`} target="_blank" rel="noopener noreferrer" data-no-ui-translation>{post.linked_game.title}</a></p> : <p>{locale === 'en' ? 'The related game is not currently available.' : '关联游戏暂不可见。'}</p>)}</>}
          {post.experiment_id && <CommunityExperimentDetails key={`record:${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} />}
          {section==='workshop' && !!post.attachments?.length && <CommunityGamePreview key={`play:${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} />}
          {session.moderator && section==='workshop' && post.experiment_id && post.moderation==='published' && <CommunityTemplateReview key={`template:${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} reuse={post.reuse} />}
          <p>{locale === 'en' ? 'Reuse permission: ' : '复用权限：'}{locale === 'en' ? ({ 'view-only': 'Viewing only', download: 'Download permitted', 'remix-with-credit': 'Adaptation permitted with attribution' }[post.reuse] || post.reuse) : ({ 'view-only': '仅展示', download: '允许下载', 'remix-with-credit': '署名后可改编' }[post.reuse] || post.reuse)}</p>
          {post.attachments?.length ? <CommunityMediaGallery key={`${post.id}:${post.updated_at}`} postId={post.id} revision={post.updated_at} busy={busy || !!editing} onDetach={mine && post.owner_id === session.user?.id && post.moderation === 'draft' && !post.experiment_id ? mediaId => revise(post, 'detach', mediaId) : undefined} /> : null}
          {post.moderation === 'published' && post.owner_id !== session.user?.id && <div>
            {reports.find(item => item.post_id === post.id) ? <Tag>{(() => {
              const status = reports.find(item => item.post_id === post.id)?.status
              return status === 'resolved' ? (locale === 'en' ? 'Report resolved' : '举报已处理') : status === 'dismissed' ? (locale === 'en' ? 'Report dismissed' : '举报未采纳') : (locale === 'en' ? 'Report awaiting review' : '举报待处理')
            })()}</Tag> : <Button disabled={busy || !session.user} onClick={() => { setReportTarget(post); setReportReason(''); setReportError('') }}>{locale === 'en' ? 'Report Post' : '举报作品'}</Button>}
          </div>}
          {mine && post.owner_id === session.user?.id && <div className="community-toolbar">
            <Button disabled={busy || !!editing} onClick={() => edit(post)}>{locale === 'en' ? 'Edit' : '编辑'}</Button>
            {post.moderation !== 'draft' && <Popconfirm title={locale === 'en' ? 'Return this post to a private draft?' : '将这篇帖子转为私有草稿？'} description={locale === 'en' ? 'It will be removed from public view and the review queue. Existing files are retained. Publication will require a new review.' : '帖子会从公开列表和待审队列撤回，原附件保留，再次公开需要重新审核。'} okText={locale === 'en' ? 'Return to Draft' : '转为草稿'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => revise(post, 'withdraw')}><Button disabled={busy || !!editing}>{locale === 'en' ? 'Return to Draft' : '转为草稿'}</Button></Popconfirm>}
            {post.moderation === 'draft' && !post.experiment_id && <Button disabled={busy || !!editing} onClick={() => { setUploadTarget(post); setUploadsOpen(true) }}>{locale === 'en' ? 'Add Attachments' : '添加附件'}</Button>}
            {post.experiment_id && <p>{locale === 'en' ? 'This experiment keeps its evidence snapshot. Use a new draft for new or replacement evidence; the description and reuse permission remain editable.' : '本实验保留原证据快照。新增或替换证据请新建草稿；介绍和复用权限仍可编辑。'}</p>}
            {section === 'workshop' && post.moderation === 'draft' && !post.experiment_id && <Button disabled={busy || !!editing} onClick={() => setExperimentTarget(post)}>{locale === 'en' ? 'Import Experiment Record' : '导入实验记录'}</Button>}
            {['draft', 'rejected'].includes(post.moderation) && <Popconfirm title={locale === 'en' ? 'Submit this post for review?' : '提交这篇帖子进行审核？'} okText={locale === 'en' ? 'Submit' : '提交'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => submitForReview(post)}>
              <Button disabled={busy || !!editing || section === 'art' && !post.attachments?.length}>{locale === 'en' ? 'Submit for Review' : '提交审核'}</Button>
            </Popconfirm>}
            <Popconfirm title={locale === 'en' ? 'Delete this post?' : '删除这篇帖子？'} description={locale === 'en' ? 'The original game and media files will be retained.' : '原游戏和素材文件会保留。'} okText={locale === 'en' ? 'Delete' : '删除'} cancelText={locale === 'en' ? 'Cancel' : '取消'} onConfirm={() => remove(post)}>
              <Button danger disabled={busy}>{locale === 'en' ? 'Delete' : '删除'}</Button>
            </Popconfirm>
          </div>}
        </article>)}</div></Spin>
        {!loading && !posts.length && <p>这里还没有作品。</p>}
      </>}
    </div>
    {session?.user && <CommunityProfile key={`profile:${session.user.id}`} open={profileOpen} onClose={()=>setProfileOpen(false)} onSaved={()=>void loadPosts()} />}
    {session?.user && <CommunityUploads key={session.user.id} target={uploadTarget} open={uploadsOpen} section={section} configured={!!session.uploadsConfigured} onClose={() => { setUploadsOpen(false); setUploadTarget(null) }} onBusy={setBusy} onChanged={loadPosts} />}
    {session?.user && <CommunityExperimentImport key={`experiment:${session.user.id}`} target={experimentTarget} configured={!!session.uploadsConfigured} onClose={() => setExperimentTarget(null)} onBusy={setBusy} onChanged={loadPosts} />}
    <Modal title={locale === 'en' ? 'Report Post' : '举报作品'} open={!!reportTarget} confirmLoading={busy} closable={!busy} maskClosable={!busy} keyboard={!busy}
      okText={locale === 'en' ? 'Submit Report' : '提交举报'} cancelText={locale === 'en' ? 'Cancel' : '取消'} okButtonProps={{ disabled: !reportReason.trim() }} cancelButtonProps={{ disabled: busy }}
      onOk={() => void submitReport()} onCancel={() => { if (!busy) setReportTarget(null) }}>
      <p data-no-ui-translation>{reportTarget?.title}</p>
      <p>请说明侵权、敏感信息或其他问题，并指出具体位置。举报说明只供审核处理。</p>
      {reportError && <Alert type="error" showIcon message={reportError} />}
      <Input.TextArea disabled={busy} aria-label="举报说明" placeholder="举报说明" rows={4} maxLength={2000} value={reportReason} onChange={event => setReportReason(event.target.value)} />
    </Modal>
  </main>
}
