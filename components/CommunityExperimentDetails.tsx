'use client'

import { useEffect, useState } from 'react'
import { Alert, Button, Spin, Tag } from 'antd'
import { useUiLocale } from './ui/LanguageSwitcher'
import type { ExperimentRecord } from '@/lib/community-types'

export default function CommunityExperimentDetails({ postId, revision }: { postId: string; revision: string }) {
  const en = useUiLocale() === 'en'
  const [open, setOpen] = useState(false)
  const [record, setRecord] = useState<ExperimentRecord | null>(null)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController(), timer = window.setTimeout(() => controller.abort(), 20_000)
    let active = true
    setRecord(null); setError(false); setLoaded(false)
    void fetch(`/api/community/posts/${postId}/experiment`, { cache: 'no-store', signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('record')
      const result = await response.json()
      if (active) { setRecord(result.record); setLoaded(true) }
    }).catch(() => { if (active) setError(true) }).finally(() => window.clearTimeout(timer))
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [postId, revision, open, refresh])
  const unknown = en ? 'Not recorded' : '未记录'
  const state = (value: string) => en ? ({ passed: 'Passed (reported)', failed: 'Failed (reported)', 'not-tested': 'Not tested' }[value] || value) : ({ passed: '作者报告通过', failed: '作者报告失败', 'not-tested': '未测试' }[value] || value)
  return <details className="community-experiment-details" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{en ? 'Experiment Record' : '实验记录'}</summary>
    {open && <div>
      <Alert type="info" showIcon message={en ? 'Author-reported record. Model use, costs, evidence provenance and playthrough results have not been independently verified. Publication approval is separate from template selection.' : '以下为作者记录，模型用量、费用、证据来源和通关结果未经独立验收。帖子审核与优秀模板入选是两回事。'} />
      <Button onClick={() => setRefresh(value => value + 1)}>{en ? 'Refresh Record' : '刷新记录'}</Button>
      {error ? <p role="alert">{en ? 'The record is unavailable or its evidence has changed. Refresh the post before relying on its results.' : '记录暂不可读，或证据已变化。请刷新帖子后再核对结果。'}</p> : !loaded ? <Spin size="small" /> : !record ? <p>{en ? 'No experiment record is linked.' : '尚未关联实验记录。'}</p> : <>
        <p><Tag>{en ? ({ completed: 'Game completed (reported)', partial: 'Partially completed', failed: 'Failed' }[record.outcome]) : ({ completed: '作者报告游戏完成', partial: '部分完成', failed: '失败' }[record.outcome])}</Tag><Tag>{en ? ({ low: 'Low tier', medium: 'Mid tier', high: 'High tier' }[record.tier]) : ({ low: '低档', medium: '中档', high: '高档' }[record.tier])}</Tag><Tag>{record.language === 'en' ? 'English' : '简体中文'}</Tag></p>
        <h4>{en ? 'Original Story Input' : '原始故事输入'}</h4><p data-no-ui-translation className="community-record-text">{record.story}</p>
        <dl className="community-record-facts">
          <dt>{en ? 'Text model' : '文字模型'}</dt><dd data-no-ui-translation>{record.models.textProvider} · {record.models.textModelId}</dd>
          <dt>{en ? 'Image model' : '图片模型'}</dt><dd data-no-ui-translation>{record.models.imageProvider} · {record.models.imageModelId}</dd>
          <dt>{en ? 'Levels / pairing' : '关卡 / 对比组'}</dt><dd data-no-ui-translation>{record.levelCount} · {record.pairId}</dd>
          <dt>{en ? 'Project version' : '项目版本'}</dt><dd>{record.projectCommit === 'unknown' ? unknown : record.projectCommit} · {record.dirtyWorktree ? (en ? 'Includes uncommitted changes' : '包含未提交改动') : (en ? 'Clean worktree reported' : '作者记录为干净工作树')}</dd>
          <dt>{en ? 'Prompt version' : '提示词版本'}</dt><dd data-no-ui-translation>{record.promptVersion}</dd>
          <dt>{en ? 'Recorded cost / budget' : '记录费用 / 当时预算'}</dt><dd>{record.usage.costUsd === null ? unknown : `USD ${record.usage.costUsd.toFixed(4)}`} / USD {record.usage.budgetUsd.toFixed(2)} · {en ? ({ actual: 'Actual cost reported by author', estimated: 'Estimate', unknown: 'Cost unknown' }[record.usage.costSource]) : ({ actual: '作者填报实际费用', estimated: '估算', unknown: '费用未知' }[record.usage.costSource])}</dd>
          <dt>{en ? 'Calls / tokens' : '调用量 / Token'}</dt><dd>{record.usage.calls ?? unknown} / {record.usage.tokens ?? unknown}</dd>
          <dt>{en ? 'Automatically supplemented tasks' : '自动补齐任务'}</dt><dd>{record.fallback.supplementedTasks} / {record.fallback.totalImageTasks}</dd>
        </dl>
        {record.usage.costUsd !== null && record.usage.costUsd > record.usage.budgetUsd && <Alert type="warning" showIcon message={en ? 'The recorded cost exceeds this run’s stated budget.' : '记录费用超过该轮填写的预算。'} />}
        <h4>{en ? 'Stage Timings' : '阶段耗时'}</h4>
        <div className="community-record-table-wrap"><table className="community-record-table"><thead><tr>{(en ? ['Stage','Start','End','Elapsed'] : ['阶段','开始','结束','耗时']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{record.timing.map((item,index) => <tr key={index}><td data-no-ui-translation>{item.stage}</td><td>{item.startedAt ?? unknown}</td><td>{item.endedAt ?? unknown}</td><td>{item.elapsedMs === null ? unknown : `${(item.elapsedMs / 1000).toFixed(1)} s`}</td></tr>)}</tbody></table></div>
        {!record.timing.length && <p>{unknown}</p>}
        <h4>{en ? 'Author’s Checks' : '作者检查记录'}</h4>
        {Object.entries(record.checks).map(([name,check]) => <div key={name} className="community-record-item"><strong>{en ? ({ storyFidelity: 'Story fidelity', artQuality: 'Artwork quality', webPlaythrough: 'Web playthrough', offlinePlaythrough: 'Offline playthrough' }[name]) : ({ storyFidelity: '故事忠实度', artQuality: '画面质量', webPlaythrough: '网页试玩', offlinePlaythrough: '离线试玩' }[name])} · {state(check.state)}</strong>{check.note && <p data-no-ui-translation>{check.note}</p>}<small data-no-ui-translation>{check.evidenceIds.join(', ') || '—'}</small></div>)}
        {record.fallback.items.length > 0 && <><h4>{en ? 'Supplemented Assets' : '补齐明细'}</h4>{record.fallback.items.map((item,index) => <p key={index}><span data-no-ui-translation>{item.assetId}{item.pose ? ` / ${item.pose}` : ''}</span> · {item.source === 'builtin' ? (en ? 'Built-in asset' : '内置素材') : (en ? 'Existing character pose' : '已有角色姿势')} · <span data-no-ui-translation>{item.reason}</span></p>)}</>}
        <h4>{en ? 'Issues and Follow-up' : '问题与后续任务'}</h4>{record.issues.length ? record.issues.map(item => <div key={item.id} className="community-record-item"><Tag>{en ? ({ blocking: 'Blocking', major: 'Major', minor: 'Minor' }[item.severity]) : ({ blocking: '阻断', major: '严重', minor: '轻微' }[item.severity])}</Tag><Tag>{item.resolved ? (en ? 'Resolved (reported)' : '作者记录已解决') : (en ? 'Unresolved' : '未解决')}</Tag><p data-no-ui-translation>{item.description}</p><p data-no-ui-translation>{item.proposedFix}</p><small data-no-ui-translation>{item.taskId} · {item.evidenceIds.join(', ')}</small></div>) : <p>{en ? 'No issues were recorded. This is not proof that the game is defect-free.' : '作者未填写问题，不代表游戏没有缺陷。'}</p>}
      </>}
    </div>}
  </details>
}
