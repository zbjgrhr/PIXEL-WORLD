'use client'

import { useMemo, useState } from 'react'
import { Alert, Button, Card, Checkbox, Collapse, Image, Input, Progress, Select, Space, Switch, Tag, Typography } from 'antd'
import { Beaker, Copy, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { ASSET_CATALOG, ASSET_CATALOG_BY_CATEGORY, canDuplicateAsset } from '@/lib/asset-catalog'
import type { AssetCategory, AssetDefinition, GameSpec } from '@/types'

const { Paragraph, Text, Title } = Typography
const { TextArea } = Input

interface AssetPlannerProps {
  spec: GameSpec
  onChange: (spec: GameSpec) => void
  onGenerate: () => void
  onCancel: () => void
  onTestApi: () => void
  isGenerating: boolean
  isTesting: boolean
  progress: number
}

const STATUS_COLOR: Record<AssetDefinition['status'], string> = {
  pending: 'default', generating: 'processing', success: 'success', failed: 'error', cancelled: 'warning',
}

export default function AssetPlanner({ spec, onChange, onGenerate, onCancel, onTestApi, isGenerating, isTesting, progress }: AssetPlannerProps) {
  const [newCategory, setNewCategory] = useState<AssetCategory>('groundEnemy')
  const levels = spec.levels.map((level, index) => ({ label: `L${index + 1} ${level.name}`, value: level.id }))
  const imageAssets = spec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet'))
  const completed = imageAssets.filter((asset) => asset.status === 'success' && asset.url).length
  const pendingCount = imageAssets.filter((asset) => !asset.url || asset.status === 'failed').length
  const grouped = useMemo(() => {
    const groups = new Map<string, AssetDefinition[]>()
    for (const asset of spec.assets) {
      const family = asset.category.includes('Enemy') ? asset.category.split('Enemy')[0] + 'Enemy' : asset.category.startsWith('boss') ? 'boss' : asset.category.startsWith('level') ? 'level' : 'gameplay'
      groups.set(family, [...(groups.get(family) || []), asset])
    }
    return [...groups.entries()]
  }, [spec.assets])

  const patchAsset = (id: string, patch: Partial<AssetDefinition>) => onChange({
    ...spec,
    assets: spec.assets.map((asset) => asset.id === id ? { ...asset, ...patch } : asset),
  })

  const duplicate = (asset: AssetDefinition) => onChange({
    ...spec,
    assets: [...spec.assets, { ...asset, id: `${asset.category}-${Date.now()}`, title: `${asset.title} Copy`, status: asset.kind === 'audio' || asset.kind === 'runtime' ? 'success' : 'pending', url: undefined, error: undefined }],
  })

  const addAsset = () => {
    const catalog = ASSET_CATALOG_BY_CATEGORY[newCategory]
    const base = spec.assets.find((asset) => asset.category === newCategory)
    const asset: AssetDefinition = base
      ? { ...base, id: `${newCategory}-${Date.now()}`, title: `${catalog.label} ${spec.assets.filter((item) => item.category === newCategory).length + 1}`, status: base.kind === 'audio' || base.kind === 'runtime' ? 'success' : 'pending', url: undefined, error: undefined }
      : { id: `${newCategory}-${Date.now()}`, category: newCategory, title: catalog.label, prompt: catalog.defaultPrompt, enabled: true, levelIds: spec.levels.map((level) => level.id), kind: catalog.kind, status: catalog.kind === 'audio' || catalog.kind === 'runtime' ? 'success' : 'pending' }
    onChange({ ...spec, assets: [...spec.assets, asset] })
  }

  return (
    <Card size="small" title="素材规划与关卡分配 / Asset Plan">
      <Alert type="info" showIcon message={`已启用 ${imageAssets.length} 个图片任务；完成 ${completed} 个；待生成 ${pendingCount} 个。程序音效和行为不调用图片 API。`} style={{ marginBottom: 12 }} />
      <Space wrap style={{ marginBottom: 12 }}>
        <Select value={newCategory} onChange={setNewCategory} style={{ minWidth: 220 }} options={ASSET_CATALOG.filter((entry) => entry.repeatable !== false).map((entry) => ({ value: entry.category, label: entry.label }))} />
        <Button icon={<Plus size={14} />} onClick={addAsset}>新增素材</Button>
        <Button icon={<Beaker size={14} />} loading={isTesting} onClick={onTestApi}>测试 API（生成1张）</Button>
        {isGenerating ? <Button danger icon={<X size={14} />} onClick={onCancel}>停止队列</Button> : <Button type="primary" icon={<RotateCcw size={14} />} disabled={!pendingCount} onClick={onGenerate}>生成已选素材</Button>}
      </Space>
      {isGenerating && <Progress percent={progress} status="active" style={{ marginBottom: 12 }} />}
      <Collapse size="small" defaultActiveKey={['groundEnemy', 'gameplay', 'level']} items={grouped.map(([group, assets]) => ({
        key: group,
        label: `${group} · ${assets.length}`,
        children: <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {assets.map((asset) => <Card key={asset.id} size="small" title={<Space><Switch size="small" checked={asset.enabled} onChange={(enabled) => patchAsset(asset.id, { enabled })} /><Text strong>{asset.title}</Text></Space>} extra={<Tag color={STATUS_COLOR[asset.status]}>{asset.status}</Tag>}>
            {asset.url && <Image src={asset.url} alt={asset.title} height={120} style={{ width: '100%', objectFit: asset.category === 'levelBackground' ? 'cover' : 'contain', imageRendering: 'pixelated' }} />}
            <TextArea value={asset.prompt} rows={3} onChange={(event) => patchAsset(asset.id, { prompt: event.target.value, status: asset.url ? asset.status : asset.kind === 'audio' || asset.kind === 'runtime' ? 'success' : 'pending' })} style={{ marginTop: asset.url ? 8 : 0 }} />
            <Checkbox.Group value={asset.levelIds} options={levels} onChange={(values) => patchAsset(asset.id, { levelIds: values as string[] })} style={{ display: 'grid', gap: 4, marginTop: 8 }} />
            {asset.error && <Paragraph type="danger" ellipsis={{ rows: 2, expandable: true }} style={{ marginTop: 8 }}>{asset.error}</Paragraph>}
            <Space style={{ marginTop: 8 }}>
              {canDuplicateAsset(asset.category) && <Button size="small" icon={<Copy size={12} />} onClick={() => duplicate(asset)}>复制</Button>}
              {asset.category !== 'hero' && <Button size="small" danger icon={<Trash2 size={12} />} onClick={() => onChange({ ...spec, assets: spec.assets.filter((item) => item.id !== asset.id) })}>删除</Button>}
            </Space>
          </Card>)}
        </div>,
      }))} />
    </Card>
  )
}
