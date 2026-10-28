'use client'

import { Button, Checkbox, Collapse, Input, InputNumber, Select, Space, Tag } from 'antd'
import type { GameSpec, NarrativeSpec, StoryObjective } from '@/types'
import { narrativeProblems } from '@/lib/narrative'
import { recordNarrativeEdit, replaceNarrativeReference } from '@/lib/narrative-editing'
import type { RefinementScope } from '@/lib/refine-game-spec'
import NarrativeSuggestions from './NarrativeSuggestions'
export type { RefinementScope } from '@/lib/refine-game-spec'

const FIELDS = [['premise', '故事概念'], ['incitingIncident', '事件起因'], ['motivation', '主角动机'], ['conflict', '主要冲突'], ['bossRelation', 'Boss 与故事的关系'], ['resolution', '结局方向'], ['opening', '开场剧情'], ['ending', '通关结局']] as const
const KINDS = [{ value: 'collect', label: '收集物品' }, { value: 'defeat', label: '击败普通敌人' }, { value: 'boss', label: '击败 Boss' }, { value: 'reach', label: '到达地点' }, { value: 'interact', label: '对象交互' }]

export default function NarrativeEditor({ spec, onChange, onRefine, disabled = false }: { spec: GameSpec; onChange: (spec: GameSpec) => void; onRefine?: (scope: RefinementScope) => void; disabled?: boolean }) {
  const n = spec.narrative
  if (!n) return null
  const patch = (next: NarrativeSpec) => onChange({ ...spec, narrative: next })
  const authoredRequirement = (path: string, value: string): NarrativeSpec => ({ ...n, source: { ...n.source, origin: 'player', playerFields: { ...n.source.playerFields, [path]: value } } })
  const toggleLock = (path: string, value: string, checked: boolean) => {
    const lockedFields = { ...n.source.lockedFields }
    if (checked) lockedFields[path] = value
    else delete lockedFields[path]
    patch({ ...n, source: { ...n.source, lockedFields } })
  }
  const textField = (path: string, label: string, value: string, edit: (value: string) => void, rows = 2, commit?: (value: string, before: string) => void) => <div className="narrative-field" key={path}>
    <span><b>{label}</b><Tag>{n.source.playerFields[`narrative.${path}`] !== undefined ? '玩家填写' : '系统补充'}</Tag><Checkbox disabled={disabled} checked={path in n.source.lockedFields} onChange={e => toggleLock(path, value, e.target.checked)}>锁定原文</Checkbox></span>
    <Input.TextArea disabled={disabled} aria-label={label} value={value} rows={rows} onChange={e => edit(e.target.value)} onFocus={e => { if (commit) e.currentTarget.dataset.originalReference = value }} onBlur={e => { const before = e.currentTarget.dataset.originalReference; if (commit && before && e.currentTarget.value && before !== e.currentTarget.value) commit(e.currentTarget.value, before) }} />
  </div>
  const chapterPatch = (index: number, key: string, value: unknown, path?: string, text?: string) => {
    const next = { ...n, chapters: n.chapters.map((c, i) => i === index ? { ...c, [key]: value } : c) }
    patch(path ? recordNarrativeEdit(next, path, text ?? String(value)) : next)
  }
  const problems = narrativeProblems(spec)
  const refine = (scope: RefinementScope) => onRefine && <Button size="small" disabled={disabled} onClick={() => onRefine(scope)}>优化本组设定</Button>
  const levelOptions = spec.levels.map((level, i) => ({ value: level.id, label: `第 ${i + 1} 关 · ${level.name}` }))
  return <section className="narrative-editor" aria-label="故事与任务编辑">
    <header><h3>故事与任务设定</h3><p>可以直接修改或锁定原文。优化本组只更新这一组，补全空缺只填写空白内容；修改后需要重新审核。</p>{onRefine && <Button disabled={disabled} onClick={() => onRefine('missing')}>补全空缺字段</Button>}</header>
    <NarrativeSuggestions spec={spec} onChange={onChange} disabled={disabled} />
    <Collapse size="small" items={[
      { key: 'source', label: '原始构想与生成来源', children: <><Tag>{n.source.origin === 'model' ? '文字模型补充' : n.source.origin === 'player' ? '玩家编辑' : '内置规则补充'}</Tag><p className="narrative-original">{n.source.originalStory || '没有完整故事，系统已主动补充。'}</p><p>原始构想保持可查看。剧情扩写与素材提示词分别保存。</p></> },
      { key: 'story', label: '故事、动机与结局', children: <Space direction="vertical" style={{ width: '100%' }}>{refine('story')}{FIELDS.map(([key, label]) => textField(key, label, n[key], value => patch(recordNarrativeEdit({ ...n, [key]: value }, key, value)), key === 'opening' || key === 'ending' ? 4 : 2))}</Space> },
      { key: 'characters', label: '角色与人物关系', children: <Space direction="vertical" style={{ width: '100%' }}>{refine('characters')}{n.characters.map((character, index) => <section className="narrative-character" key={character.id}>
        <b>{character.role}</b>
        {(['name', 'motivation', 'relationship'] as const).map(key => textField(`characters.${character.id}.${key}`, `${character.role}${{ name: '姓名', motivation: '动机', relationship: '人物关系' }[key]}`, character[key], value => {
          const path = `characters.${character.id}.${key}`
          const edited = recordNarrativeEdit(n, path, value)
          if (key === 'name' && (character.id === 'hero' || character.id === 'boss')) {
            onChange({ ...spec, [character.id]: { ...spec[character.id], name: value }, narrative: { ...edited, characters: edited.characters.map((item, i) => i === index ? { ...item, name: value } : item) } })
          } else patch({ ...edited, characters: edited.characters.map((item, i) => i === index ? { ...item, [key]: value } : item) })
        }, key === 'name' ? 1 : 2, key === 'name' ? (value, before) => patch(replaceNarrativeReference(n, before, value)) : undefined))}
      </section>)}</Space> },
      { key: 'clues', label: '关键线索与回应', children: <Space direction="vertical" style={{ width: '100%' }}><p>让线索在前面的关卡出现，并在后面解释它的用途。完成文字编辑后，会同步替换未锁定剧情中的相同原文；调整关卡后请核对任务反馈。</p>{n.clues.map((clue, index) => {
        const update = (key: 'setup' | 'payoff' | 'levelId' | 'payoffLevelId', value: string) => {
          const next = recordNarrativeEdit({ ...n, clues: n.clues.map((item, i) => i === index ? { ...item, [key]: value } : item) }, `clues.${clue.id}.${key}`, value)
          patch(next)
        }
        return <section className="narrative-character" key={clue.id}>
          {textField(`clues.${clue.id}.setup`, `线索 ${index + 1} · 铺垫`, clue.setup, value => update('setup', value), 2, (value, before) => patch(replaceNarrativeReference(n, before, value)))}
          <label>出现关卡<Select disabled={disabled} aria-label={`线索 ${index + 1} 出现关卡`} value={clue.levelId} options={levelOptions} onChange={value => update('levelId', value)} /></label>
          {textField(`clues.${clue.id}.payoff`, `线索 ${index + 1} · 回应`, clue.payoff, value => update('payoff', value), 2, (value, before) => patch(replaceNarrativeReference(n, before, value)))}
          <label>回应关卡<Select disabled={disabled} aria-label={`线索 ${index + 1} 回应关卡`} value={clue.payoffLevelId} options={levelOptions} onChange={value => update('payoffLevelId', value)} /></label>
        </section>
      })}</Space> },
      { key: 'chapters', label: '分关剧情、任务与完成条件', children: <Space direction="vertical" style={{ width: '100%' }}>{refine('chapters')}<Collapse size="small" items={n.chapters.map((chapter, index) => {
        const prefix = `chapters.${chapter.levelId}`
        const level = spec.levels.find(item => item.id === chapter.levelId)
        return { key: chapter.levelId, label: `第 ${index + 1} 关 · ${chapter.title}`, children: <Space direction="vertical" style={{ width: '100%' }}>
          {(['title', 'arrival', 'departure', 'bossBefore', 'bossAfter'] as const).filter(key => level?.hasBoss || !key.startsWith('boss')).map(key => textField(`${prefix}.${key}`, { title: '章节标题', arrival: '进入关卡', departure: '完成本关', bossBefore: 'Boss 战前', bossAfter: 'Boss 战后' }[key], chapter[key], value => chapterPatch(index, key, value, `${prefix}.${key}`), key === 'title' ? 1 : 3))}
          {chapter.points.map((point, pointIndex) => <section key={point.id} className="narrative-character"><b>场景交互点</b>{(['name', 'description'] as const).map(key => textField(`${prefix}.points.${point.id}.${key}`, key === 'name' ? '交互点名称' : '交互点说明', point[key], value => chapterPatch(index, 'points', chapter.points.map((item, i) => i === pointIndex ? { ...item, [key]: value } : item), `${prefix}.points.${point.id}.${key}`, value)))}</section>)}
          {chapter.objectives.map((objective, taskIndex) => {
            const update = (changes: Partial<StoryObjective>, key?: 'description' | 'feedback') => chapterPatch(index, 'objectives', chapter.objectives.map((item, i) => i === taskIndex ? { ...item, ...changes } : item), key ? `${prefix}.objectives.${objective.id}.${key}` : undefined, key ? changes[key] : undefined)
            const targets = objective.kind === 'interact' ? chapter.points.filter(p => p.kind === 'interact').map(p => ({ value: p.id, label: p.name })) : objective.kind === 'reach' ? [{ value: 'exit', label: '本关出口' }, ...chapter.points.filter(p => p.kind === 'reach').map(p => ({ value: p.id, label: p.name }))] : [{ value: objective.kind === 'collect' ? 'collectible' : objective.kind === 'boss' ? 'boss' : 'enemies', label: objective.kind === 'collect' ? spec.collectible.name : objective.kind === 'boss' ? spec.boss.name : '普通敌人' }]
            return <section key={objective.id} className="narrative-task-editor">
              {textField(`${prefix}.objectives.${objective.id}.description`, '任务说明', objective.description, value => update({ description: value }, 'description'), 1)}
              <Space wrap><Select disabled={disabled} aria-label="任务类型" value={objective.kind} options={KINDS} onChange={kind => update({ kind, count: 1, target: kind === 'collect' ? 'collectible' : kind === 'defeat' ? 'enemies' : kind === 'boss' ? 'boss' : kind === 'reach' ? 'exit' : chapter.points.find(p => p.kind === 'interact')?.id || '' })} /><Select disabled={disabled} aria-label="任务对象" value={objective.target} options={targets} onChange={target => update({ target })} /><InputNumber disabled={disabled} aria-label="任务数量" min={1} max={Math.max(1, objective.kind === 'collect' ? level?.collectibleCount || 0 : objective.kind === 'defeat' ? level?.enemyCount || 0 : 1)} value={objective.count} onChange={value => update({ count: value || 1 })} /></Space>
              <Select disabled={disabled} mode="multiple" aria-label="任务前置条件" placeholder="无前置条件" style={{ width: '100%' }} value={objective.prerequisites} options={chapter.objectives.slice(0, taskIndex).map(o => ({ value: o.id, label: o.description }))} onChange={prerequisites => update({ prerequisites })} />
              {textField(`${prefix}.objectives.${objective.id}.feedback`, '任务完成反馈', objective.feedback, value => update({ feedback: value }, 'feedback'))}
            </section>
          })}
        </Space> }
      })} /></Space> },
      { key: 'art', label: '美术与角色固定特征', children: <Space direction="vertical" style={{ width: '100%' }}>{refine('art')}<p>手填的画面方向和角色固定特征会保留；优化可继续补充配色、光照等细节。</p><label>画面方向<Input.TextArea disabled={disabled} aria-label="画面方向" value={spec.visualStyle.artDirection} rows={3} onChange={e => onChange({ ...spec, narrative: authoredRequirement('visualStyle.artDirection', e.target.value), visualStyle: { ...spec.visualStyle, artDirection: e.target.value } })} /></label><label>角色固定特征<Input.TextArea disabled={disabled} aria-label="角色固定特征" value={spec.creativeBrief?.identityRules || ''} rows={3} onChange={e => onChange({ ...spec, narrative: authoredRequirement('creativeBrief.identityRules', e.target.value), creativeBrief: { ...spec.creativeBrief, identityRules: e.target.value } })} /></label></Space> },
      { key: 'check', label: `内容与任务检查：${problems.length ? `${problems.filter(p => p.severity !== 'warning').length} 个阻断项，${problems.filter(p => p.severity === 'warning').length} 条提醒` : '程序检查通过，等待你确认内容'}`, children: problems.length ? <ul>{problems.map((problem, i) => <li key={i}><Tag color={problem.severity === 'warning' ? 'gold' : 'red'}>{problem.severity === 'warning' ? '待确认' : '需修改'}</Tag>{problem.message}<small>{problem.path}</small></li>)}</ul> : <p>已检查叙事字段、任务条件、引用关系和可用数量。人物动机、故事因果及实际试玩结果还需要分别确认。</p> },
    ]} />
  </section>
}
