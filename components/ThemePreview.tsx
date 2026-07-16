'use client'

import { useMemo, useState } from 'react'
import { Button, Card, Empty, Image, Skeleton, Space, Tag, Typography, message } from 'antd'
import { RotateCcw, Scissors, Trash2 } from 'lucide-react'
import { useGameStore } from '@/lib/store'
import { getThemeId } from '@/lib/theme-utils'
import { ASSET_TYPES } from '@/types'
import type { AssetType, RegeneratingImages, ThemePreviewProps } from '@/types'

const { Text, Title, Paragraph } = Typography

const EMPTY_STATE = Object.fromEntries(ASSET_TYPES.map((type) => [type, false])) as RegeneratingImages
const LABELS: Record<AssetType, string> = {
  character: 'Player / 主角',
  enemy: 'Enemy / 敌人',
  weapon: 'Weapon / 武器',
  projectile: 'Projectile / 弹射物',
  attackEffect: 'Attack Effect / 攻击特效',
  collectible: 'Collectible / 收集品',
  boss: 'Boss / 首领',
  background: 'Background / 背景',
  ground: 'Ground Texture / 地面材质',
  obstacle: 'Obstacle / 障碍物',
}

function AssetCard({
  type,
  url,
  loading,
  onCutout,
  onRegenerate,
}: {
  type: AssetType
  url?: string
  loading: boolean
  onCutout?: () => void
  onRegenerate?: () => void
}) {
  return (
    <Card size="small" title={LABELS[type]} styles={{ body: { padding: 12 } }}>
      {loading ? (
        <Skeleton.Image active style={{ width: 190, height: 190 }} />
      ) : url ? (
        <Image
          src={url}
          alt={LABELS[type]}
          style={{ width: 190, height: 190, objectFit: type === 'background' ? 'cover' : 'contain', imageRendering: 'pixelated' }}
        />
      ) : (
        <div style={{ width: 190, height: 190, display: 'grid', placeItems: 'center', background: '#f7f7f7' }}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not generated" />
        </div>
      )}
      <Space style={{ marginTop: 10 }} wrap>
        {onCutout && url && (
          <Button size="small" icon={<Scissors size={13} />} onClick={onCutout}>Cutout</Button>
        )}
        {onRegenerate && (
          <Button size="small" icon={<RotateCcw size={13} />} onClick={onRegenerate}>Regenerate</Button>
        )}
      </Space>
    </Card>
  )
}

const ThemePreview: React.FC<ThemePreviewProps> = ({
  isLoading,
  loadingMessage,
  gameData,
  selectedTheme,
  themes,
  regeneratingImages = EMPTY_STATE,
  apiKey = '',
  onRegenerateImage,
  onDeleteTheme,
}) => {
  const { getProcessedImagesForTheme, updateProcessedImage } = useGameStore()
  const [processing, setProcessing] = useState<RegeneratingImages>(EMPTY_STATE)
  const selected = themes.find((theme) => theme.id === selectedTheme)
  const data = gameData?.data
  const firstLevel = data?.levels?.[0]
  const processed = getProcessedImagesForTheme(getThemeId(selectedTheme))

  const urls = useMemo(() => ({
    character: processed.character || data?.characterUrl || selected?.characterImage || '',
    enemy: processed.enemy || data?.enemyUrl || selected?.enemyImage || '',
    weapon: processed.weapon || data?.weaponUrl || selected?.weaponImage || '',
    projectile: processed.projectile || data?.projectileUrl || selected?.projectileImage || '',
    attackEffect: processed.attackEffect || data?.attackEffectUrl || selected?.attackEffectImage || '',
    collectible: processed.collectible || data?.collectibleUrl || selected?.collectibleImage || '',
    boss: processed.boss || data?.bossUrl || selected?.bossImage || '',
    background: processed.background || firstLevel?.backgroundUrl || selected?.backgroundImage || '',
    ground: processed.ground || firstLevel?.groundUrl || selected?.groundImage || '',
    obstacle: processed.obstacle || firstLevel?.obstacleUrl || selected?.obstacleImage || '',
  }), [processed, data, firstLevel, selected])

  const handleCutout = async (type: AssetType) => {
    const url = urls[type]
    if (!url) return
    setProcessing((previous) => ({ ...previous, [type]: true }))
    try {
      const response = await fetch('/api/process-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, type }),
      })
      const result = await response.json()
      if (!response.ok || !result.success) throw new Error(result.error || 'Cutout failed')
      updateProcessedImage(getThemeId(selectedTheme), type, result.data.processedUrl)
      message.success(`${LABELS[type]} 已完成抠图。`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '抠图失败。')
    } finally {
      setProcessing((previous) => ({ ...previous, [type]: false }))
    }
  }

  if (isLoading) {
    return (
      <Card style={{ flex: 1 }}>
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <Title level={3}>Generating the playable world</Title>
          <Paragraph>{loadingMessage || '正在生成隔离素材、关卡和战斗数据…'}</Paragraph>
          <Skeleton active paragraph={{ rows: 10 }} />
        </Space>
      </Card>
    )
  }

  if (!selected) return <Card style={{ flex: 1 }}><Empty description="Select a theme" /></Card>

  const assetOrder: AssetType[] = [
    'character', 'enemy', 'weapon', 'projectile', 'attackEffect',
    'collectible', 'boss', 'ground', 'obstacle',
  ]
  const spec = data?.spec || selected.spec

  return (
    <Card
      style={{ flex: 1, overflowY: 'auto' }}
      title={<div><Title level={3} style={{ margin: 0 }}>{selected.name}</Title><Text type="secondary">Theme Preview & Game Assets</Text></div>}
      extra={selectedTheme.startsWith('custom-') && onDeleteTheme ? (
        <Button danger icon={<Trash2 size={15} />} onClick={() => onDeleteTheme(selectedTheme)}>Delete</Button>
      ) : null}
    >
      {spec && (
        <Card size="small" style={{ marginBottom: 20, background: '#f6f9ff' }}>
          <Space wrap>
            <Tag color="blue">{spec.levels.length} Levels</Tag>
            <Tag color="red">{spec.enemies.length} Enemy Type</Tag>
            <Tag color="purple">{spec.weapon.mode} Combat</Tag>
            <Tag color="volcano">Final Boss</Tag>
            <Tag color="green">Collectibles</Tag>
          </Space>
          <Paragraph ellipsis={{ rows: 2, expandable: true }} style={{ margin: '10px 0 0' }}>{spec.world}</Paragraph>
        </Card>
      )}

      <Title level={4}>Level Backgrounds / 关卡背景</Title>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        {(data?.levels?.length ? data.levels : [{ id: 'fallback', backgroundUrl: urls.background }]).map((level, index) => (
          <Card key={level.id} size="small" title={`Level ${index + 1}`}>
            {level.backgroundUrl || urls.background ? (
              <Image
                src={level.backgroundUrl || urls.background}
                alt={`Level ${index + 1}`}
                style={{ width: 240, height: 138, objectFit: 'cover', imageRendering: 'pixelated' }}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        ))}
      </div>
      {onRegenerateImage && (
        <Button
          style={{ marginBottom: 24 }}
          icon={<RotateCcw size={14} />}
          loading={regeneratingImages.background}
          onClick={() => onRegenerateImage(selectedTheme, 'background', apiKey)}
        >
          Regenerate all level backgrounds
        </Button>
      )}

      <Title level={4}>Isolated Game Assets / 独立游戏素材</Title>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
        {assetOrder.map((type) => (
          <AssetCard
            key={type}
            type={type}
            url={urls[type]}
            loading={regeneratingImages[type] || processing[type]}
            onCutout={type !== 'ground' ? () => handleCutout(type) : undefined}
            onRegenerate={onRegenerateImage ? () => onRegenerateImage(selectedTheme, type, apiKey) : undefined}
          />
        ))}
      </div>
    </Card>
  )
}

export default ThemePreview
