'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Empty, Image, Progress, Skeleton, Space, Switch, Tag, Typography, message } from 'antd'
import { Download, RotateCcw, Trash2, Volume2 } from 'lucide-react'
import { normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AnimationPose, AssetDefinition, ThemePreviewProps } from '@/types'
import { ExportValidationError, exportGameZip } from '@/lib/export-game'

const { Text, Title, Paragraph } = Typography

function AnimatedSpritePreview({ asset }: { asset: AssetDefinition }) {
  const [frame, setFrame] = useState(0)
  const [pose, setPose] = useState<AnimationPose>('idle')
  const animation = normalizeAnimationSpec(asset.animation)
  useEffect(() => {
    setFrame(0)
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % animation.columns), 1000 / animation.fps)
    return () => window.clearInterval(timer)
  }, [animation.columns, animation.fps, pose])
  if (!asset.url) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not generated" />
  const x = animation.columns > 1 ? frame / (animation.columns - 1) * 100 : 0
  const row = Math.max(0, Math.min(animation.rows - 1, animation.states[pose]))
  const y = animation.rows > 1 ? row / (animation.rows - 1) * 100 : 0
  const poses: Array<{ value: AnimationPose; label: string }> = [
    { value: 'idle', label: '站立' },
    { value: 'walk', label: '走路' },
    { value: 'jump', label: '跳跃' },
    { value: 'attack', label: '攻击' },
    { value: 'hit', label: '受击' },
    { value: 'death', label: '死亡' },
  ]
  return <div>
    <div style={{ width: 190, height: 150, margin: '0 auto', backgroundImage: `url("${asset.url}")`, backgroundRepeat: 'no-repeat', backgroundSize: `${animation.columns * 100}% ${animation.rows * 100}%`, backgroundPosition: `${x}% ${y}%`, imageRendering: 'pixelated' }} />
    <Space size={[4, 4]} wrap style={{ marginTop: 8 }}>
      {poses.map((item) => <Button key={item.value} size="small" type={pose === item.value ? 'primary' : 'default'} onClick={() => setPose(item.value)}>{item.label}</Button>)}
    </Space>
    {animation.layoutVersion === 1 && <Tag color="gold" style={{ marginTop: 8 }}>旧版 5 行素材 · 跳跃暂用走路姿态</Tag>}
  </div>
}

function PlannedAssetCard({ asset, levelOptions, loading, onRegenerate, onUpdate }: {
  asset: AssetDefinition
  levelOptions: Array<{ label: string; value: string }>
  loading: boolean
  onRegenerate?: () => void
  onUpdate?: (patch: Partial<AssetDefinition>) => void
}) {
  return <Card size="small" title={<Space><Switch size="small" checked={asset.enabled} onChange={(enabled) => onUpdate?.({ enabled })} /><Text strong>{asset.title}</Text></Space>} extra={<Tag color={asset.status === 'success' ? 'success' : asset.status === 'failed' ? 'error' : asset.status === 'generating' ? 'processing' : 'default'}>{asset.status}</Tag>}>
    {loading ? <Skeleton.Image active style={{ width: 190, height: 150 }} /> : asset.kind === 'spriteSheet' ? <AnimatedSpritePreview asset={asset} /> : asset.kind === 'image' ? (
      asset.url ? <Image src={asset.url} alt={asset.title} style={{ width: 190, height: 150, objectFit: asset.category === 'levelBackground' ? 'cover' : 'contain', imageRendering: 'pixelated' }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not generated" />
    ) : asset.kind === 'audio' ? <div style={{ minHeight: 110, display: 'grid', placeItems: 'center', background: '#f4f7ff', borderRadius: 8 }}><Space direction="vertical" align="center"><Volume2 /><Text>{asset.sound?.waveform} · {asset.sound?.frequency}Hz</Text><Tag color="purple">Web Audio</Tag></Space></div> : <div style={{ minHeight: 110, padding: 12, background: '#f7f7f7', borderRadius: 8 }}><Paragraph>{asset.prompt}</Paragraph><Tag color="cyan">{asset.motion?.pattern || 'Runtime Effect'}</Tag></div>}
    <Checkbox.Group value={asset.levelIds} options={levelOptions} onChange={(values) => onUpdate?.({ levelIds: values as string[] })} style={{ display: 'grid', gap: 4, marginTop: 10 }} />
    {asset.error && <Paragraph type="danger" ellipsis={{ rows: 2, expandable: true }} style={{ margin: '8px 0 0' }}>{asset.error}</Paragraph>}
    {onRegenerate && (asset.kind === 'image' || asset.kind === 'spriteSheet') && <Button size="small" icon={<RotateCcw size={13} />} loading={loading} onClick={onRegenerate} style={{ marginTop: 10 }}>Regenerate</Button>}
  </Card>
}

const ThemePreview: React.FC<ThemePreviewProps> = ({ isLoading, loadingMessage, gameData, selectedTheme, themes, apiKey = '', regeneratingAssetIds = [], onRegenerateAsset, onUpdateAsset, onDeleteTheme }) => {
  const [isExporting, setIsExporting] = useState(false)
  const selected = themes.find((theme) => theme.id === selectedTheme)
  const data = gameData?.data
  const spec = data?.spec || selected?.spec
  const levelOptions = spec?.levels.map((level, index) => ({ label: `L${index + 1} ${level.name}`, value: level.id })) || []
  const groupedAssets = useMemo(() => {
    if (!spec) return []
    const groups = new Map<string, AssetDefinition[]>()
    for (const asset of spec.assets) {
      const group = asset.category === 'levelBackground' || asset.category === 'levelMusic' || asset.category === 'levelEffect'
        ? 'Level Assets / 关卡素材'
        : asset.category.includes('Enemy') ? 'Enemies / 敌人体系'
          : asset.category.startsWith('boss') ? 'Boss' : 'Gameplay Assets / 战斗与场景素材'
      groups.set(group, [...(groups.get(group) || []), asset])
    }
    return [...groups.entries()]
  }, [spec])

  const exportGame = async () => {
    if (!spec) return
    setIsExporting(true)
    try {
      await exportGameZip(spec)
      message.success('离线游戏 ZIP 已生成，包内不含 API Key。')
    } catch (error) {
      if (error instanceof ExportValidationError) message.error(`无法导出，缺少：${error.missing.join('、')}`, 8)
      else message.error(error instanceof Error ? error.message : '导出失败。')
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) return <Card style={{ flex: 1 }}><Title level={3}>Generating selected assets</Title><Paragraph>{loadingMessage}</Paragraph><Progress percent={Math.round((spec?.assets.filter((asset) => asset.status === 'success').length || 0) / Math.max(1, spec?.assets.length || 1) * 100)} status="active" /><Skeleton active paragraph={{ rows: 8 }} /></Card>
  if (!selected) return <Card style={{ flex: 1 }}><Empty description="Select a theme" /></Card>

  return <Card style={{ flex: 1, overflowY: 'auto' }} title={<div><Title level={3} style={{ margin: 0 }}>{selected.name}</Title><Text type="secondary">Theme Preview, Asset Assignment & Game Data</Text></div>} extra={<Space><Button type="primary" icon={<Download size={15} />} loading={isExporting} disabled={!spec} onClick={() => { void exportGame() }}>Export ZIP</Button>{selectedTheme.startsWith('custom-') && onDeleteTheme ? <Button danger icon={<Trash2 size={15} />} onClick={() => onDeleteTheme(selectedTheme)}>Delete</Button> : null}</Space>}>
    {spec ? <>
      <Card size="small" style={{ marginBottom: 20, background: '#f6f9ff' }}>
        <Space wrap><Tag color="blue">V{spec.version}</Tag><Tag color="blue">{spec.levels.length} Levels</Tag><Tag color="purple">{spec.assets.filter((asset) => asset.enabled).length} Enabled Assets</Tag><Tag color="green">{spec.assets.filter((asset) => asset.url).length} Generated Images</Tag></Space>
        <Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ margin: '10px 0 0' }}>{spec.world}</Paragraph>
      </Card>
      {groupedAssets.map(([group, assets]) => <section key={group} style={{ marginBottom: 28 }}><Title level={4}>{group}</Title><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(235px, 1fr))', gap: 14 }}>{assets.map((asset) => <PlannedAssetCard key={asset.id} asset={asset} levelOptions={levelOptions} loading={regeneratingAssetIds.includes(asset.id)} onRegenerate={onRegenerateAsset ? () => onRegenerateAsset(selectedTheme, asset.id, apiKey) : undefined} onUpdate={onUpdateAsset ? (patch) => onUpdateAsset(selectedTheme, asset.id, patch) : undefined} />)}</div></section>)}
    </> : <Empty description="No V3 game specification" />}
  </Card>
}

export default ThemePreview
