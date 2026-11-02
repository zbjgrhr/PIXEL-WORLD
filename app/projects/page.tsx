'use client'

import { useEffect, useRef, useState } from 'react'
import ProjectHeader from '@/components/ui/ProjectHeader'
import Link from 'next/link'
import { readProjectFile, buildSpatialZip } from '@/lib/project-file'
import { Mountain, Music2, Compass, FolderOpen, Sparkles, ArrowUpRight } from 'lucide-react'
import { PLAY_MODES, duplicateProject, serializeProject, portableProject, projectFileName, type WorldProject } from '@/lib/project-library'
import { listProjects, saveProject, migrateLegacyProjects } from '@/lib/project-library-db'
import { exportGameZip, gameZipFileName } from '@/lib/export-game'
import './projects.css'

async function download(project: WorldProject) {
  const url = URL.createObjectURL(new Blob([serializeProject(await portableProject(project))], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = projectFileName(project.title); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function Projects() {
  const [projects, setProjects] = useState<WorldProject[]>([]), [selected, setSelected] = useState<WorldProject | null>(null)
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [archived, setArchived] = useState(false), [busy, setBusy] = useState(true), [dirty, setDirty] = useState(false), [notice, setNotice] = useState('正在读取本机项目…'), [error, setError] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const refresh = async () => setProjects(await listProjects())
  useEffect(() => { void (async () => { try { await migrateLegacyProjects(); await refresh(); setNotice('项目保存在当前浏览器。换设备前请导出项目数据。') } catch (e) { setError(String(e)) } finally { setBusy(false) } })() }, [])
  useEffect(() => { const guard = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault() }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard) }, [dirty])
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work() } catch (e) { setNotice('本次操作未完成，当前修改仍保留。'); setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const save = async (p: WorldProject) => { const saved = await saveProject(p); setSelected(saved); setDirty(false); await refresh(); setNotice('已保存到本机项目库。'); return saved }
  const choose = (p: WorldProject) => { if (dirty && !confirm('当前修改尚未保存，放弃修改并切换项目？')) return; setSelected(structuredClone(p)); setDirty(false) }
  const edit = (patch: Partial<WorldProject>) => { if (selected) { setSelected({ ...selected, ...patch, ...(selected.spatial ? { spatial: { ...selected.spatial, title: patch.title ?? selected.title, brief: patch.draft?.story ?? selected.draft.story } } : {}) }); setDirty(true) } }
  const shown = projects.filter(p => p.archived === archived && (filter === 'all' || p.mode === filter) && p.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return <main className="project-library pixel-world-app">
    <ProjectHeader activeSection="projects" projectNote="你的故事、素材与关卡，都在这里继续。项目保存在当前浏览器。" />
    <div className="library-body">
    <section className="library-intro"><div><p className="library-eyebrow"><Sparkles size={14} aria-hidden="true" /> YOUR SAVED WORLDS</p><h1>我的作品</h1><p>在主页制作游戏，在这里管理草稿、继续编辑与保存作品。</p></div><span className="library-total"><FolderOpen size={16} aria-hidden="true" />{projects.filter(p => !p.archived).length} 个世界</span></section>
    <div className="project-create"><Link className="library-create-link" href="/">＋ 去主页创作游戏</Link><span className="library-create-help">平台动作 / 节奏音游 / 自由探索，都在主页制作</span><button type="button" disabled={busy || dirty} onClick={() => file.current?.click()}>导入项目 / 游戏 ZIP</button><input hidden ref={file} type="file" accept=".json,.zip" onChange={e => { const input = e.currentTarget, picked = input.files?.[0]; input.value = ''; if (!picked) return; void run(async () => { await save(await readProjectFile(picked)); setNotice('已作为独立新项目导入；原项目不会被覆盖。') }) }} /></div>
    <p className="library-notice" role="status">{busy ? '正在处理…' : notice}</p>{error && <p className="library-error" role="alert">{error}</p>}
    <div className="library-workspace"><section className="library-list"><div className="library-section-heading"><h2><FolderOpen size={19} aria-hidden="true" />我的世界</h2><span>继续未完的冒险</span></div><div className="library-tools"><input aria-label="搜索项目" placeholder="搜索作品标题" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="筛选玩法" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部玩法</option>{Object.entries(PLAY_MODES).map(([key, v]) => <option key={key} value={key}>{v.name}</option>)}</select><label><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />归档</label></div>
      <p className="library-count">{shown.length} 个{archived ? '归档' : ''}项目 · 最近修改优先</p>{!shown.length && <div className="library-empty">{search ? '没有找到匹配的作品。' : '到世界主页选择玩法，创建你的第一个世界。'}</div>}
      {shown.map(p => <button disabled={busy} className={`project-row ${selected?.id === p.id ? 'selected' : ''}`} key={p.id} onClick={() => choose(p)}><span className={`project-glyph ${p.mode}`}>{p.mode === 'platformer' ? <Mountain size={24} /> : p.mode === 'rhythm' ? <Music2 size={24} /> : <Compass size={24} />}</span><span><strong>{p.title}</strong><small>{PLAY_MODES[p.mode].name} · {PLAY_MODES[p.mode].dimension} · {p.mode === 'platformer' ? `${p.draft.levelCount} 关 · ${p.publishedSpec ? '已有试玩版本' : '草稿'}` : p.spatial ? '基础模板 · 可试玩' : '策划草稿'}</small><small>{new Date(p.updatedAt).toLocaleString('zh-CN')}{p.legacyKey ? ' · 旧作品已接入' : ''}</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>)}
    </section><section className="project-detail" aria-label="项目详情">{selected ? <><p className="library-eyebrow">{PLAY_MODES[selected.mode].dimension} / {PLAY_MODES[selected.mode].name}</p><h2>{selected.title}</h2><label>作品标题<input value={selected.title} maxLength={selected.mode === 'platformer' ? 120 : 80} onChange={e => edit({ title: e.target.value, draft: { ...selected.draft, name: e.target.value, spec: selected.draft.spec ? { ...selected.draft.spec, title: e.target.value } : undefined } })} /></label><label>背景与创意<textarea value={selected.draft.story} onChange={e => edit({ draft: { ...selected.draft, story: e.target.value } })} /></label>
      <p>{selected.mode === 'platformer' ? `平台动作 · ${selected.draft.levelCount}关 · ${selected.publishedSpec ? '已有试玩版本' : '制作草稿'}` : selected.spatial ? `3D基础模板 · ${selected.spatial.genre === 'rhythm' ? `${selected.spatial.rhythm.bpm} BPM / 四轨 / ${selected.spatial.rhythm.bars}小节` : `${selected.spatial.goalCount}颗水晶 / ${selected.spatial.arenaSize}场景尺寸`}` : '待制作的策划草稿，去主页继续设定。'}</p>
      <button className="primary" disabled={busy || selected.archived || !selected.title.trim()} onClick={() => void run(async () => { const p = dirty ? await save(selected) : selected; location.assign(`/?project=${encodeURIComponent(p.id)}`) })}>保存并回主页继续编辑 →</button>
      <div className="project-actions"><button disabled={busy || !dirty || !selected.title.trim()} onClick={() => void run(async () => { await save(selected) })}>{dirty ? '保存修改' : '已保存'}</button><button disabled={busy || dirty} onClick={() => void run(async () => { await save(duplicateProject(selected)) })}>复制项目</button><button disabled={busy || !selected.title.trim()} onClick={() => void run(async () => { await download(selected) })}>导出项目数据</button>{(selected.publishedSpec || selected.spatial) && <button disabled={busy || dirty} onClick={() => void run(async () => { if (selected.mode === 'platformer' && selected.publishedSpec) await exportGameZip(selected.publishedSpec); else if (selected.spatial) { const response = await fetch('/spatial/runtime.js'); if (!response.ok) throw Error('运行资源加载失败。'); const blob = buildSpatialZip(selected.spatial, await response.text()), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = gameZipFileName(selected.title); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) } })}>导出游戏 ZIP</button>}<button disabled={busy || dirty} onClick={() => void run(async () => { await save({ ...selected, archived: !selected.archived }); setSelected(null) })}>{selected.archived ? '恢复项目' : '归档项目'}</button></div><small>项目数据用于继续编辑；游戏 ZIP 用于离线游玩。修改草稿后需在编辑器重新制作，已有试玩版本才会更新。</small></> : <div className="library-empty"><span className="empty-mark"><Compass size={42} strokeWidth={1} aria-hidden="true" /></span><h2>选择一份世界档案</h2><p>打开旧作，或为下一次冒险留下起点。</p></div>}</section></div>
    </div>
  </main>
}
