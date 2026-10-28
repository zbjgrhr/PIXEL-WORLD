'use client'

import { Button, Space, Tag } from 'antd'
import type { GameSpec, NarrativeSuggestion } from '@/types'
import { decideNarrativeSuggestion, narrativeSuggestionStatus, pendingNarrativeSuggestions } from '@/lib/narrative-suggestions'

export default function NarrativeSuggestions({ spec, onChange, disabled = false }: { spec: GameSpec; onChange: (spec: GameSpec) => void; disabled?: boolean }) {
  const n = spec.narrative
  if (!n?.suggestions?.length) return null
  const pending = pendingNarrativeSuggestions(spec)
  const processed = n.suggestions.filter(item => narrativeSuggestionStatus(n, item) !== 'pending')
  const compare = (item: NarrativeSuggestion, actionable: boolean) => <article className="narrative-suggestion" key={item.id}>
    <b>{item.label}</b>
    <div className="narrative-suggestion-comparison"><section><span>{actionable ? '当前使用' : '修改前'}</span><p>{item.before || '（空白）'}</p></section><section><span>模型建议</span><p>{item.after}</p></section></div>
    {actionable ? <><small>{item.reason}</small><Space wrap><Button size="small" type="primary" disabled={disabled} aria-label={`采用建议：${item.label}`} onClick={() => onChange(decideNarrativeSuggestion(spec, item.id, 'accepted'))}>采用建议</Button><Button size="small" disabled={disabled} aria-label={`保留原文：${item.label}`} onClick={() => onChange(decideNarrativeSuggestion(spec, item.id, 'dismissed'))}>保留原文</Button></Space></> : <Tag>{({ accepted: '已采用', dismissed: '已保留原文', stale: '此项已另行修改', pending: '待决定' })[narrativeSuggestionStatus(n, item)]}</Tag>}
  </article>
  return <section className="narrative-suggestions" aria-label="模型修改建议">
    <h4>{pending.length ? `${pending.length} 项改动由你决定` : '修改建议已处理'}</h4>
    {pending.length > 0 && <><p>这些改动涉及你已确定的故事设定，目前仍使用原文。逐项决定后再批准；采用建议后需要重新检查草案。</p><Button size="small" disabled={disabled} onClick={() => onChange(pending.reduce((next, item) => decideNarrativeSuggestion(next, item.id, 'dismissed'), spec))}>全部保留原文</Button>{pending.map(item => compare(item, true))}</>}
    {processed.length > 0 && <details><summary>查看已处理的 {processed.length} 项建议</summary>{processed.map(item => compare(item, false))}</details>}
  </section>
}
