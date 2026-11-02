'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Collapse, Input, InputNumber, Select, Space, Tag, Typography } from 'antd'
import { Compass, Download, Music2, RotateCcw, Save, Sparkles } from 'lucide-react'
import StageHeading from './ui/StageHeading'
import WorkflowNotice from './ui/WorkflowNotice'
import type { WorldProject } from '@/lib/project-library'
import { createSpatialProject, parseSpatialProject, SPATIAL_ENVIRONMENTS, type SpatialProject } from '@/lib/spatial/spec'
import { buildSpatialHtml } from '@/lib/spatial/export'
import { buildSpatialZip } from '@/lib/project-file'
import { gameZipFileName } from '@/lib/export-game'
import { restoreSpatialDraft, spatialDraftKey } from '@/lib/spatial/studio-draft'
import './HomeSpatialStudio.css'

interface Props {
  mode: SpatialProject['genre']
  initialProject?: WorldProject
  onSave: (spec: SpatialProject, existing?: WorldProject) => Promise<WorldProject>
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function HomeSpatialStudio({ mode, initialProject, onSave }: Props) {
  const initial = () => createSpatialProject(mode === 'rhythm' ? '星夜遗迹中的四轨节奏演奏。' : '在森林中寻找水晶，开启传送门。', mode)
  const [config, setConfig] = useState<SpatialProject>(initial), [applied, setApplied] = useState<SpatialProject>(initial)
  const [runtime, setRuntime] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('本地模板制作，不调用AI或产生模型费用。')
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [dirty, setDirty] = useState(false)
  const [stage, setStage] = useState<'idea' | 'rules' | 'publish'>('idea')
  const [hasPreview, setHasPreview] = useState(Boolean(initialProject?.spatial))
  const record = useRef<WorldProject | undefined>(initialProject), request = useRef(0), hydratedProject = useRef<string | undefined>(undefined)
  const draftKey = spatialDraftKey(mode, initialProject?.id)
  useEffect(() => {
    setReady(false)
    try {
      if (initialProject) {
        if (hydratedProject.current === initialProject.id) return
        const restored = restoreSpatialDraft(localStorage.getItem(draftKey) || localStorage.getItem(spatialDraftKey(mode)), mode, initialProject)
        if (restored) {
          setConfig(restored.config); setApplied(restored.applied); record.current = initialProject
          hydratedProject.current = initialProject.id; setHasPreview(restored.previewCreated); setStage(restored.stage); setDirty(restored.dirty)
          setNotice(restored.dirty ? '已恢复此作品尚未保存的草稿；已有试玩保留。' : '已恢复此作品和制作步骤。')
          return
        }
        const p = initialProject.spatial || { ...createSpatialProject(initialProject.draft.story || initial().brief, mode), title: initialProject.title, rhythm: { bpm: Math.max(60, Math.min(160, initialProject.planning.bpm)), bars: 8, offsetMs: 0 } }
        setConfig(p); setApplied(parseSpatialProject(p)); record.current = initialProject; setNotice('已打开项目。修改规则后，点击“应用并更新试玩”。')
        hydratedProject.current = initialProject.id
        setHasPreview(Boolean(initialProject.spatial)); setStage(initialProject.spatial ? 'rules' : 'idea')
      } else {
        const saved = restoreSpatialDraft(localStorage.getItem(draftKey), mode)
        if (saved) {
          setConfig(saved.config); setApplied(saved.applied); record.current = saved.record; setDirty(saved.dirty); setNotice('已恢复此玩法的本机草稿。')
          setHasPreview(saved.previewCreated); setStage(saved.stage)
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : '草稿无法恢复，原数据保留。') }
    finally { setReady(true) }
    // This component is keyed by gameplay; opening another project explicitly replaces its form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProject?.id, mode])
  useEffect(() => {
    if (!ready) return
    try { localStorage.setItem(draftKey, JSON.stringify({ config, applied, record: record.current, previewCreated: hasPreview, stage })) }
    catch { setError('本机草稿保存失败，请导出项目数据备份。') }
  }, [ready, config, applied, draftKey, hasPreview, stage])
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/spatial/runtime.js', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw Error('试玩资源加载失败，请刷新页面重试。')
      const source = await r.text(); buildSpatialHtml(initial(), source); setRuntime(source)
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => { controller.abort(); request.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const html = useMemo(() => runtime ? buildSpatialHtml(applied, runtime) : '', [applied, runtime])
  const edit = (patch: Partial<SpatialProject>) => { setConfig(p => ({ ...p, ...patch })); setDirty(true) }
  const apply = () => {
    try { const p = parseSpatialProject(config); setApplied(p); setHasPreview(true); setRevision(n => n + 1); setError(''); setNotice('规则已应用，右侧试玩已更新。修改内容尚需保存到项目库。'); return p }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null }
  }
  const save = async () => {
    const p = apply(); if (!p) return
    const run = ++request.current; setBusy(true)
    try {
      const saved = await onSave(p, record.current)
      if (request.current !== run) return
      record.current = saved; hydratedProject.current = saved.id; setDirty(false)
      localStorage.setItem(draftKey, JSON.stringify({ config: p, applied: p, record: saved, previewCreated: true, stage }))
      setNotice('已保存到项目库，可从“我的作品”继续编辑。')
    } catch (e) { if (request.current === run) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (request.current === run) setBusy(false) }
  }
  const name = mode === 'rhythm' ? '节奏音游' : '自由探索'
  const Icon = mode === 'rhythm' ? Music2 : Compass
  const storyReady = Boolean(config.title.trim() && config.brief.trim())
  const previewStale = hasPreview && JSON.stringify(config) !== JSON.stringify(applied)
  const steps = [
    { id: 'idea' as const, css: 'idea', title: '写创意', note: storyReady ? '名称与创意已填写' : '填写名称与创意' },
    { id: 'rules' as const, css: 'agents', title: '设置玩法', note: mode === 'rhythm' ? '节奏与演奏规则' : '场景与探索规则' },
    { id: 'publish' as const, css: 'assets', title: '试玩与保存', note: hasPreview ? dirty ? '试玩已创建，待保存' : '作品已保存' : '先确认玩法规则' },
  ]
  const stepIndex = steps.findIndex(s => s.id === stage)
  const description = stage === 'idea' ? '先在中栏写下游戏名称与创意，再选择场景和玩法规则。' : stage === 'rules' ? (mode === 'rhythm' ? '设置节奏、曲目长度和判定偏移，确认后创建试玩。' : '设置探索环境、水晶目标和场景细节，确认后创建试玩。') : '在右栏试玩检查效果，再保存作品或导出游戏。'
  const createPreview = () => { if (apply()) setStage('publish') }
  const exportGame = () => { if (runtime && hasPreview) download(buildSpatialZip(applied, runtime), gameZipFileName(applied.title)) }
  const exportData = () => { try { const p = parseSpatialProject(config); download(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), gameZipFileName(p.title).replace(/\.zip$/i, '.json')) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  const numeric = (label: string, key: 'arenaSize' | 'goalCount' | 'decorationCount' | 'playerSpeed' | 'seed', min: number, max: number, step = 1) => <label className="spatial-field" htmlFor={`${mode}-${key}`}><Typography.Text strong>{label}</Typography.Text><InputNumber id={`${mode}-${key}`} aria-label={label} min={min} max={max} step={step} value={config[key]} disabled={busy} onChange={v => { if (typeof v === 'number') edit({ [key]: Math.max(min, Math.min(max, v)) }) }} style={{ width: '100%' }} /></label>
  const example = (environment: 'forest' | 'night' | 'snow') => {
    const brief = mode === 'rhythm' ? `${environment === 'snow' ? '雪原' : environment === 'night' ? '星夜遗迹' : '森林'}中的四轨节奏演奏。` : `${environment === 'snow' ? '雪原' : environment === 'night' ? '星夜遗迹' : '森林'}探险：寻找散落的水晶，开启传送门。`
    edit(createSpatialProject(brief, mode)); setNotice('已填入示例创意；已有试玩保留，确认规则后再更新。')
  }
  return <div className="world-columns home-spatial-studio">
    <aside className="creator-panel">
      <div className="creator-sidebar studio-control-rail" style={{ padding: 16 }}>
        <div className="studio-control-card">
          <nav className="studio-step-nav" aria-label={`${name}制作步骤`}>
            <div className="studio-step-nav-heading"><strong>制作进度</strong><span>选择步骤，查看当前要做的事</span></div>
            {steps.map((step, i) => <button key={step.id} disabled={busy} className={`studio-step-${step.css}${stage === step.id ? ' is-active' : ''}${i === 0 && storyReady || i === 1 && hasPreview || i === 2 && !!record.current && !dirty ? ' is-complete' : ''}`} aria-current={stage === step.id ? 'step' : undefined} onClick={() => setStage(step.id)}><b>0{i + 1}</b><span>{step.title}<small>{step.note}</small></span></button>)}
          </nav>
          <div className={`studio-control-stage-intro studio-control-stage-${steps[stepIndex].css}`}><span>第 {stepIndex + 1} 步 · 当前操作</span><h2>{steps[stepIndex].title}</h2><p>{description}</p></div>
          <div className="studio-step-guidance"><strong>{stage === 'idea' ? '从你的创意开始' : stage === 'rules' ? '让玩法符合你的想法' : '把这个世界保存下来'}</strong><p>{stage === 'idea' ? '名称和创意是后续场景与玩法规则的依据。' : stage === 'rules' ? '改动会保留在草稿，确认并创建试玩后，右栏才会更新。' : '项目库保留可继续编辑的作品；游戏ZIP用于分享和离线游玩。'}</p><Button type="link" onClick={() => document.getElementById(`spatial-editor-${mode}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>前往中栏填写与检查 →</Button></div>
          <div className="studio-control-content spatial-source-panel"><Typography.Text strong>当前制作方式</Typography.Text><div className="workflow-source-summary"><strong><Icon size={15} aria-hidden="true" />内置{name}模板</strong><span>打开即用 · 无需配置密钥</span></div><Typography.Text type="secondary">{mode === 'rhythm' ? '四轨击打与程序合成旋律，场景由内置几何体构成。' : '第一人称方块场景，寻找水晶并开启出口。'}</Typography.Text><Collapse ghost size="small" items={[{ key: 'scope', label: '查看当前支持范围', children: <p>{mode === 'rhythm' ? '可调BPM、小节数、判定偏移、环境和布局种子；外部歌曲、自定义谱面尚未接入。' : '可调环境、场景尺寸、景物数量、移动速度和水晶目标；复杂模型、自由地形编辑尚未接入。'} 本地模板不调用AI，VR尚未验收。</p> }]} /></div>
        </div>
      </div>
    </aside>
    <section id={`spatial-editor-${mode}`} className="themes-panel" aria-label={`${name}设定`}>
      <div className="studio-workspace">
        <header className="studio-workspace-header"><small>第 {stepIndex + 1} 步 · {steps[stepIndex].title}</small><div className="workflow-project-status" role="status"><span>{dirty ? '当前创意待保存' : record.current ? '作品已保存' : '从你的创意开始'}</span>{previewStale && <span>已有试玩保留，应用后更新</span>}</div><h2>{stage === 'idea' ? '先写游戏名称和创意' : stage === 'rules' ? mode === 'rhythm' ? '设置节奏与演奏规则' : '设计你的探索世界' : '检查效果，保存你的作品'}</h2><p>{description}</p></header>
        {stage === 'idea' && <section className="studio-section prompt-section studio-workspace-editor">
          <StageHeading title="名称与创意" />
          <div className="story-template-picker"><Typography.Text strong>从示例创意开始（可选）</Typography.Text><Typography.Text type="secondary">选择一个起点，再把它改成你想要的世界。</Typography.Text><Space wrap><Button disabled={busy} onClick={() => example('forest')}>森林{mode === 'rhythm' ? '回响' : '寻宝'}</Button><Button disabled={busy} onClick={() => example('night')}>星夜{mode === 'rhythm' ? '节拍' : '遗迹'}</Button><Button disabled={busy} onClick={() => example('snow')}>雪原{mode === 'rhythm' ? '旋律' : '探险'}</Button></Space></div>
          <label className="spatial-field" htmlFor={`${mode}-title`}><Typography.Text strong>游戏名称 <Typography.Text type="danger">*</Typography.Text></Typography.Text><Input id={`${mode}-title`} aria-label="作品标题（最多80字）" value={config.title} disabled={busy} maxLength={80} placeholder={mode === 'rhythm' ? '例如：星海节拍' : '例如：森林水晶之旅'} onChange={e => edit({ title: e.target.value })} /></label>
          <label className="spatial-field" htmlFor={`${mode}-brief`}><Typography.Text strong>游戏创意 <Typography.Text type="danger">*</Typography.Text></Typography.Text><Input.TextArea id={`${mode}-brief`} aria-label="创意与背景" value={config.brief} disabled={busy} maxLength={4000} rows={4} placeholder="写下世界氛围、玩家目标和你期待的游戏体验。" onChange={e => edit({ brief: e.target.value })} /></label>
          <Typography.Text type="secondary" className="spatial-help">这部分属于你的核心创意。选择模板会填入示例，确认规则后才更新试玩。</Typography.Text>
          <Button type="primary" block className="idea-next-button" disabled={busy || !storyReady} onClick={() => setStage('rules')}>完成创意，设置玩法规则 →</Button>
        </section>}
        {stage === 'rules' && <section className="studio-section studio-workspace-editor">
          <StageHeading title={mode === 'rhythm' ? '节奏与演奏规则' : '场景与探索规则'} />
          <div className="story-template-picker"><Typography.Text strong>场景环境</Typography.Text><Select aria-label="场景环境" value={config.environment} disabled={busy} onChange={v => edit({ environment: v })} options={Object.entries(SPATIAL_ENVIRONMENTS).map(([value, label]) => ({ value, label }))} style={{ width: '100%' }} /><Typography.Text type="secondary">选择森林、沙丘、星夜或雪原，让同一种玩法拥有不同氛围。</Typography.Text></div>
          {mode === 'rhythm' ? <><div className="spatial-fields">{([['bpm', 'BPM', 60, 160], ['bars', '小节数', 4, 16], ['offsetMs', '判定偏移 ms', -250, 250]] as const).map(([key, label, min, max]) => <label key={key} className="spatial-field" htmlFor={`${mode}-${key}`}><Typography.Text strong>{label}</Typography.Text><InputNumber id={`${mode}-${key}`} aria-label={label} min={min} max={max} value={config.rhythm[key]} disabled={busy} onChange={v => { if (typeof v === 'number') edit({ rhythm: { ...config.rhythm, [key]: Math.max(min, Math.min(max, v)) } }) }} style={{ width: '100%' }} /></label>)}</div><div className="story-template-picker"><Typography.Text strong>四轨演奏</Typography.Text><div className="spatial-keycaps" aria-label="击打按键"><kbd>D</kbd><kbd>F</kbd><kbd>J</kbd><kbd>K</kbd></div><Typography.Text type="secondary">四个按键对应四条轨道，也可点击游戏内按钮。判定窗口±180ms；偏移用于对齐节奏。</Typography.Text></div></> : <div className="spatial-fields">{numeric('场景尺寸', 'arenaSize', 20, 48)}{numeric('水晶目标', 'goalCount', 3, 12)}{numeric('景物数量', 'decorationCount', 8, 48)}{numeric('移动速度', 'playerSpeed', 1, 3, .1)}</div>}
          <Collapse size="small" items={[{ key: 'seed', label: '高级规则 · 布局种子', children: <>{numeric('布局种子', 'seed', 1, 2147483647)}<Typography.Text type="secondary">相同种子与规则可复现同一布局。</Typography.Text></> }]} />
          <Button disabled={busy || !storyReady} icon={<Sparkles size={15} />} onClick={() => { const p = { ...createSpatialProject(config.brief, mode), title: config.title }; edit(p); setNotice('已按创意整理本地模板，请检查规则后创建试玩。') }}>按创意整理本地模板</Button>
          <Space wrap><Button disabled={busy} onClick={() => setStage('idea')}>返回修改创意</Button><Button type="primary" disabled={busy || !ready || !storyReady} onClick={createPreview}>{hasPreview ? '应用并更新试玩 →' : '确认规则，创建试玩 →'}</Button></Space>
        </section>}
        {stage === 'publish' && <section className="studio-section studio-workspace-editor"><StageHeading title="试玩与保存" /><div className="story-template-picker"><Typography.Text strong>{config.title}</Typography.Text><Typography.Text type="secondary">{config.brief}</Typography.Text><Space wrap><Tag color="green">{name}</Tag><Tag color="blue">{SPATIAL_ENVIRONMENTS[config.environment]}</Tag><Tag color="purple">{mode === 'rhythm' ? `四轨 · ${config.rhythm.bpm} BPM · ${config.rhythm.bars}小节` : `${config.goalCount}颗水晶 · ${config.arenaSize}场景`}</Tag></Space></div><WorkflowNotice feedback={{ tone: previewStale || !hasPreview ? 'warning' : 'info', title: !hasPreview ? '先创建一个试玩版本' : previewStale ? '草稿有新修改' : '到右栏检查你的游戏', description: !hasPreview || previewStale ? '确认规则并更新试玩，再检查效果和保存作品。' : '点击游戏内的开始按钮试玩；满意后保存到项目库，之后可以继续编辑。' }} /><Button type="primary" block disabled={busy || !ready || !storyReady} onClick={apply}>{hasPreview ? '应用并更新试玩' : '创建试玩版本'}</Button><Button block icon={<Save size={15} />} loading={busy} disabled={!ready || !storyReady} onClick={() => void save()}>{dirty || !record.current ? '保存到项目库' : '作品已保存 · 再次保存'}</Button><Button block icon={<Download size={15} />} disabled={busy} onClick={exportData}>导出项目数据</Button><Button type="link" onClick={() => setStage('rules')}>返回调整玩法规则</Button></section>}
        {notice && <WorkflowNotice feedback={{ tone: 'info', title: '制作提示', description: notice }} />}
        {error && <WorkflowNotice feedback={{ tone: 'error', title: '操作未完成', description: error }} />}
      </div>
    </section>
    <section id="preview-publish-spatial" className="workspace-panel" aria-label={`${name}试玩与导出`}>
      {!hasPreview ? <Card className="theme-preview-empty-card glass-card spatial-empty-preview"><div className="preview-empty-world"><div className="preview-empty-particles" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} />)}</div><div className="preview-empty-message"><span className="preview-empty-icon"><Icon size={24} /></span><Typography.Text className="preview-empty-kicker">游戏预览</Typography.Text><Typography.Title level={2}>{mode === 'rhythm' ? '你的音乐世界会显示在这里' : '你的探索世界会显示在这里'}</Typography.Title><Typography.Paragraph>先在中栏写下名称与创意，确认玩法规则后，就能在这里走进你的世界。</Typography.Paragraph><Button type="primary" disabled={busy} onClick={() => setStage(storyReady ? 'rules' : 'idea')}>继续制作{name} →</Button></div></div></Card> : <Card className="theme-preview-card glass-card spatial-game-preview" extra={<Space wrap><Button icon={<RotateCcw size={15} />} disabled={busy || !html} onClick={() => setRevision(n => n + 1)}>重新载入试玩</Button><Button type="primary" icon={<Download size={15} />} disabled={!html || busy} onClick={exportGame}>导出游戏 ZIP</Button></Space>}>
        <Card size="small" className="spatial-preview-summary"><Space wrap><Tag color="green">{name}</Tag><Tag color="blue">3D · {SPATIAL_ENVIRONMENTS[applied.environment]}</Tag><Tag color="purple">{mode === 'rhythm' ? `四轨 · ${applied.rhythm.bpm} BPM` : `${applied.goalCount}颗水晶`}</Tag></Space><Typography.Title level={4}>{applied.title}</Typography.Title><Typography.Paragraph ellipsis={{ rows: 2, expandable: true }}>{applied.brief}</Typography.Paragraph></Card>
        {previewStale && <div className="workflow-preview-note" role="status"><strong>这里显示已创建的试玩</strong><span>中栏草稿有修改，应用后才会更新。导出的是当前试玩版本。</span></div>}
        <div className="spatial-viewport">{html ? <iframe key={revision} srcDoc={html} title={`${applied.title} · 3D试玩`} sandbox="allow-scripts allow-pointer-lock allow-downloads" allow="autoplay; fullscreen" allowFullScreen /> : <p role="status">正在准备试玩资源…</p>}</div>
        <div className="spatial-preview-footnote"><Icon size={16} aria-hidden="true" /><span>{mode === 'rhythm' ? 'D / F / J / K 击打 · 跟随节奏完成演奏' : 'WASD 移动 · 收集水晶 · 开启出口'}</span></div>
      </Card>}
    </section>
  </div>
}
