'use client'

import type { CSSProperties } from 'react'
import { Button, Collapse, Space, Tag, Typography } from 'antd'
import { BookOpen, CircleDollarSign, ExternalLink, KeyRound, Layers3, Sparkles } from 'lucide-react'
import { API_PLATFORM_GUIDES, getApiPlatformGuide, getApiPlatformsForMode } from '@/configs/api-platform-guide'

const { Text } = Typography

interface ApiPlatformGuideProps {
  selectedId: string
  mode: 'agent' | 'image'
}

function platformStyle(id: string): CSSProperties {
  const platform = getApiPlatformGuide(id)
  return { '--platform-accent': platform.accent, '--platform-soft': platform.soft } as CSSProperties
}

function PlatformBadge({ id, compact = false }: { id: string; compact?: boolean }) {
  const platform = getApiPlatformGuide(id)
  return <span className="api-platform-badge" style={platformStyle(id)}>
    <span className="api-platform-dot" />
    <span>{compact ? platform.name : `${platform.name} · ${platform.company}`}</span>
  </span>
}

function PlatformMiniCard({ id, selected }: { id: string; selected: boolean }) {
  const platform = getApiPlatformGuide(id)
  return <div className={`platform-mini-card${selected ? ' is-selected' : ''}`} style={platformStyle(id)}>
    <div className="platform-mini-heading">
      <PlatformBadge id={id} compact />
      <span className="platform-mode-label">{platform.modes.includes('agent') ? 'Agent + 图片' : '图片'}</span>
    </div>
    <p>{platform.slogan}</p>
    <div className="platform-strengths">
      {platform.strengths.slice(0, 3).map((item) => <span key={item}>{item}</span>)}
    </div>
  </div>
}

export default function ApiPlatformGuide({ selectedId, mode }: ApiPlatformGuideProps) {
  const selected = getApiPlatformGuide(selectedId)
  const modePlatforms = getApiPlatformsForMode(mode)
  const atlasPlatforms = mode === 'image' ? API_PLATFORM_GUIDES : modePlatforms

  return <div className="api-guide-wrap">
    <div className="selected-platform-guide" style={platformStyle(selected.id)}>
      <div className="selected-platform-topline">
        <PlatformBadge id={selected.id} />
        <Tag bordered={false} className="platform-cost-tag"><CircleDollarSign size={12} /> {selected.costLabel}</Tag>
      </div>
      <p className="platform-slogan">{selected.slogan}</p>
      <div className="platform-strengths">
        {selected.strengths.map((item) => <span key={item}><Sparkles size={11} />{item}</span>)}
      </div>
      <div className="platform-key-line"><KeyRound size={14} /><b>Key 格式</b><code>{selected.keyFormat}</code></div>
      <ol className="platform-steps">
        {selected.steps.map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}
      </ol>
      <div className="platform-caution">提示：{selected.caution}</div>
      <Space size={8} wrap>
        <Button size="small" type="primary" href={selected.setupUrl} target="_blank" icon={<KeyRound size={13} />}>获取 API Key</Button>
        <Button size="small" href={selected.docsUrl} target="_blank" icon={<BookOpen size={13} />}>调用文档 <ExternalLink size={11} /></Button>
      </Space>
    </div>

    <Collapse
      ghost
      className="platform-atlas-collapse"
      items={[{
        key: 'all-platforms',
        label: <Space><Layers3 size={15} /><Text strong>{mode === 'image' ? `查看全部 ${atlasPlatforms.length} 个图片平台` : `查看全部 ${modePlatforms.length} 个 Agent 直连平台`}</Text></Space>,
        children: <div className="platform-atlas-grid">
          {atlasPlatforms.map((platform) => <PlatformMiniCard key={platform.id} id={platform.id} selected={platform.id === selected.id} />)}
        </div>,
      }]}
    />
  </div>
}
