'use client'

import { Button } from 'antd'
import type { GameSpec } from '@/types'

function visualStyleSummary(spec: GameSpec): string {
  const playerStyle = spec.narrative?.source.playerFields['整体像素风格'] || spec.narrative?.source.playerFields['视觉风格']
  if (playerStyle) return playerStyle
  const direction = spec.visualStyle.artDirection.trim()
  if (/[\u3400-\u9fff]/.test(direction)) return direction
  const bitDepth = direction.match(/\b(8|16|32)-bit\b/i)?.[1]
  const view = /side[- ](?:scrolling|view)/i.test(direction) ? '侧视' : ''
  const color = /bright|vivid|high[- ]saturation/i.test(`${direction} ${spec.visualStyle.palette}`) ? '，色彩明亮' : ''
  return `${bitDepth ? `${bitDepth}-bit ` : ''}${view}像素风${color}；角色与场景保持统一画风。`
}

export default function GameSpecSummary({ spec, imageJobs, onEdit }: { spec: GameSpec; imageJobs: number; onEdit?: () => void }) {
  return <div className="workflow-spec-summary">
    <h3>{spec.title}</h3>
    <p>{spec.narrative?.opening || spec.backgroundStory}</p>
    <dl>
      <dt>世界</dt><dd>{spec.world}</dd>
      <dt>主角</dt><dd>{spec.hero.name} · {spec.narrative?.motivation || spec.hero.appearance}</dd>
      {spec.creativeBrief?.heroGoal && <><dt>主角目标</dt><dd>{spec.creativeBrief.heroGoal}</dd></>}
      <dt>战斗</dt><dd>{spec.weapon.name} · {spec.weapon.mode === 'melee' ? '近战' : spec.weapon.mode === 'ranged' ? '远程' : '近战与远程'}</dd>
      <dt>Boss</dt><dd>{spec.boss.name}</dd>
      <dt>画面方向</dt><dd>{visualStyleSummary(spec)}</dd>
      <dt>图片制作</dt><dd>预计 {imageJobs} 个任务；使用内置素材无需生图调用</dd>
    </dl>
    <ol>{spec.levels.map((level) => <li key={level.id}><strong>{level.name}</strong>：{level.environment}</li>)}</ol>
    <Button size="small" onClick={onEdit}>返回写故事修改</Button>
  </div>
}
