'use client'
import { Button, Checkbox, Collapse, Input, Select, Space } from 'antd'
import type { GameSpec, ReferenceAnalysis, ReferenceCategory, ReferenceRequirement } from '@/types'
import { useUiLocale } from './LanguageSwitcher'
import { referenceFingerprint } from '@/lib/reference-analysis'

const CATEGORIES: Array<[ReferenceCategory, string, string]> = [['characters','角色','Characters'],['map','地图','Map'],['controls','操作','Controls'],['enemies','敌人','Enemies'],['mechanisms','机关','Mechanisms'],['completion','通关条件','Completion']]
export default function ReferenceAnalysisEditor({ spec, onChange, disabled }: { spec: GameSpec; onChange: (spec: GameSpec) => void; disabled: boolean }) {
  const en = useUiLocale() === 'en'
  const value: ReferenceAnalysis = spec.reference || { version: 1, title: '', source: '', requirements: [] }
  const save = (next: ReferenceAnalysis) => onChange({ ...spec, reference: next })
  const edit = (id: string, patch: Partial<ReferenceRequirement>) => save({ ...value, requirements: value.requirements.map(r => r.id === id ? { ...r, confirmed: false, ...patch } : r) })
  return <div data-no-ui-translation><Collapse size="small" items={[{ key: 'reference', label: en ? 'Source analysis & requirement locks' : '原作分析与需求锁定', children: <Space direction="vertical" style={{ width: '100%' }}>
    <p>{en ? 'Record source facts separately from creative freedom. Required items block approval until you supply evidence and explicitly confirm a comparison. Agents preserve this list and cannot confirm it for you.' : '把原作事实和可自由生成的部分分开记录。必须还原项需提供依据并人工对照确认，否则阻止批准；Agent保留清单，不能代你确认。'}</p>
    <Input aria-label={en ? 'Source work title' : '原作名称'} placeholder={en ? 'Source work title' : '原作名称'} disabled={disabled} value={value.title} maxLength={200} onChange={e => save({ ...value, title: e.target.value })} />
    <Input aria-label={en ? 'Source reference' : '原作参考来源'} placeholder={en ? 'Reference URL or file description' : '参考网页或文件说明'} disabled={disabled} value={value.source} maxLength={2000} onChange={e => save({ ...value, source: e.target.value })} />
    {value.requirements.map(r => <section key={r.id} style={{ padding: 12, border: '1px solid #aac6b4', borderRadius: 8, width: '100%' }}>
      <Space wrap>
        <Select aria-label={en ? 'Requirement category' : '需求类别'} disabled={disabled} value={r.category} onChange={category => edit(r.id, { category })} options={CATEGORIES.map(([v, zh, eng]) => ({ value: v, label: en ? eng : zh }))} />
        <Select aria-label={en ? 'Requirement policy' : '还原策略'} disabled={disabled} value={r.policy} onChange={policy => edit(r.id, { policy })} options={[{ value: 'required', label: en ? 'Must restore' : '必须还原' }, { value: 'creative', label: en ? 'Creative freedom' : '可自由生成' }, { value: 'unsupported', label: en ? 'Not supported yet' : '暂不支持' }]} />
        <Button disabled={disabled} onClick={() => save({ ...value, requirements: value.requirements.filter(item => item.id !== r.id) })}>{en ? 'Remove' : '移除'}</Button>
      </Space>
      <Input.TextArea aria-label={en ? 'Requirement description' : '需求描述'} disabled={disabled} rows={2} value={r.description} maxLength={2000} onChange={e => edit(r.id, { description: e.target.value })} placeholder={en ? 'What must match? What can vary?' : '具体要还原什么，允许哪些差异？'} style={{ marginTop: 8 }} />
      <Input aria-label={en ? 'Requirement evidence' : '需求证据'} disabled={disabled} value={r.evidence} maxLength={2000} onChange={e => edit(r.id, { evidence: e.target.value })} placeholder={en ? 'File/event/line or a timestamp in reference footage' : '文件、事件、行号，或参考视频时间点'} style={{ marginTop: 8 }} />
      {r.policy === 'required' && <Checkbox disabled={disabled || !r.description.trim() || !r.evidence.trim()} checked={!!r.confirmed && r.confirmationKey === referenceFingerprint(spec)} onChange={e => edit(r.id, { confirmed: e.target.checked, confirmationKey: referenceFingerprint(spec) })}>{en ? 'I compared the current settings with this evidence' : '我已用上述依据对照确认当前设定'}</Checkbox>}
    </section>)}
    <Button disabled={disabled || value.requirements.length >= 100} onClick={() => save({ ...value, requirements: [...value.requirements, { id: crypto.randomUUID(), category: 'controls', policy: 'required', description: '', evidence: '', confirmed: false }] })}>{en ? 'Add requirement' : '添加需求'}</Button>
    <Button disabled={disabled || value.requirements.length > 0} onClick={() => save({ version: 1, title: 'I Wanna Be the Zomboy', source: 'IWBTZ / Blank Pixel Game(3) / Blank Pixel Game 2; v3_Interactive_Portfolio', requirements: [
      { id: 'iwbtz-controls', category: 'controls', policy: 'required', description: en ? 'Double jump, short jump on release and run-up boost; compare the movement, not just the parameter values.' : '双跳、松键截短跳跃、助跑增强起跳；需对照实际手感，不只看参数。', evidence: 'objects/obj_charReg/Create_0.gml:14-20; Step_0.gml:105-135', confirmed: false },
      { id: 'iwbtz-roster', category: 'characters', policy: 'unsupported', description: en ? 'The generic roster and respawn draws run now. Exact special abilities for all seven source characters remain unverified.' : '通用角色池与复活抽取已可运行；原作7角色各自的特殊能力与准确规则尚未逐项等价还原。', evidence: 'objects/obj_charReg,obj_charPole,obj_charGar,obj_charFoot,obj_charDr,obj_charDK,obj_charBall' },
      { id: 'iwbtz-map', category: 'map', policy: 'unsupported', description: en ? 'Selected collision tile layers can be converted. Creation code, dynamic tiles and automatic instance conversion remain unsupported.' : '已支持选择碰撞层转换；房间创建代码、动态瓦片与实例自动转换仍暂不支持。', evidence: 'rooms/tutorial/tutorial.yy; TileCompressedData; IWBTZ-reference.json' },
      { id: 'iwbtz-chomper', category: 'enemies', policy: 'unsupported', description: en ? 'Generic six-stage programs run now; the original separate head/body, circular collision and complete attacks remain unverified.' : '通用六阶段编排已运行；原作独立头身、圆形判定与完整攻击行为尚未等价还原。', evidence: 'objects/obj_chomper/Create_0.gml; Step_0.gml' },
      { id: 'iwbtz-platforms', category: 'mechanisms', policy: 'unsupported', description: en ? 'Generic horizontal and vertical platforms run now; exact source lily-pad bounds and trigger rules still need comparison.' : '已有横纵移动平台；原作荷叶的准确边界与触发规则仍需逐项对照配置。', evidence: 'objects/obj_lilypad_horizontal/Create_0.gml; objects/obj_lilypad_vertical/Create_0.gml' },
      { id: 'iwbtz-savepoint', category: 'completion', policy: 'unsupported', description: en ? 'Checkpoints and configured respawn resets run now; exact original event and instance restoration remains unverified.' : '已有存档点及明确的重置规则；原作事件和实例状态的准确恢复仍需对照核实。', evidence: 'objects/obj_savepoint; obj_savepoint_trigger' },
    ] })}>{en ? 'Load verified IWBTZ source notes' : '载入IWBTZ已核实的来源条目'}</Button>
  </Space> }]} /></div>
}
