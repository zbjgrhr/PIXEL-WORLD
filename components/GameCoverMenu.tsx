'use client'

import React, { useEffect, useState } from 'react'
import { Button, Modal, Segmented, Slider, Space, Switch, Tag, Typography } from 'antd'
import { DoorOpen, FolderOpen, Play, Settings } from 'lucide-react'
import {
  DEFAULT_GAME_SETTINGS,
  loadGameSettings,
  saveGameSettings,
  type DisplaySize,
  type GameSettings,
  type GraphicsQuality,
} from '@/lib/game-settings'
import type { GameData, Theme } from '@/types'

const { Paragraph, Text, Title } = Typography

interface GameCoverMenuProps {
  theme?: Theme
  gameData?: GameData
  coverUrl: string
  canLoad: boolean
  onStartNew: () => void
  onLoad: () => void
  onExit: () => void
}

const DISPLAY_OPTIONS = [
  { label: '紧凑', value: 'compact' },
  { label: '标准', value: 'standard' },
  { label: '宽屏', value: 'expanded' },
]

const QUALITY_OPTIONS = [
  { label: '流畅', value: 'low' },
  { label: '标准', value: 'medium' },
  { label: '鲜明', value: 'high' },
]

export default function GameCoverMenu({
  theme,
  gameData,
  coverUrl,
  canLoad,
  onStartNew,
  onLoad,
  onExit,
}: GameCoverMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_GAME_SETTINGS)
  const spec = gameData?.data?.spec || theme?.spec
  const levelCount = gameData?.data?.levels.length || spec?.levels.length || 1

  useEffect(() => {
    setSettings(loadGameSettings())
  }, [])

  const updateSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    setSettings((previous) => {
      const next = { ...previous, [key]: value }
      saveGameSettings(next)
      return next
    })
  }

  return (
    <section className="game-cover-screen" aria-label={`${spec?.title || theme?.name || 'Pixel World'} game cover`}>
      <div
        className="game-cover-art"
        style={{ backgroundImage: `url("${coverUrl}")` }}
        aria-hidden="true"
      />
      <div className="game-cover-vignette" aria-hidden="true" />

      <div className="game-cover-content">
        <div className="game-cover-copy">
          <Text className="game-cover-eyebrow">PIXEL WORLD ADVENTURE</Text>
          <Title>{spec?.title || theme?.name || 'Untitled Pixel World'}</Title>
          <Paragraph>
            {spec?.world || theme?.description || 'A world shaped from your prompt, ready to explore.'}
          </Paragraph>
          <Space wrap size={[8, 8]} className="game-cover-tags">
            <Tag>{levelCount} 个关卡</Tag>
            <Tag>{spec?.weapon.mode === 'hybrid' ? '近战＋远程' : spec?.weapon.mode || '冒险'}</Tag>
            {spec?.boss ? <Tag>最终 Boss</Tag> : null}
          </Space>
        </div>

        <nav className="game-cover-menu" aria-label="Game menu">
          <Button type="primary" size="large" icon={<Play size={18} />} onClick={onStartNew}>
            Start Game
          </Button>
          <Button size="large" icon={<FolderOpen size={18} />} disabled={!canLoad} onClick={onLoad}>
            Load Game
          </Button>
          <Button size="large" icon={<Settings size={18} />} onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
          <Button size="large" icon={<DoorOpen size={18} />} onClick={onExit}>
            Exit
          </Button>
        </nav>
      </div>

      <div className="game-cover-story">
        <span>STORY</span>
        <p>{spec?.backgroundStory || 'Your adventure begins beyond the horizon.'}</p>
      </div>

      <Modal
        className="cover-settings-modal"
        title="游戏设置"
        open={settingsOpen}
        footer={null}
        onCancel={() => setSettingsOpen(false)}
      >
        <Space direction="vertical" size={22} style={{ width: '100%' }}>
          <section>
            <Text strong>画面大小</Text>
            <Segmented
              block
              style={{ marginTop: 10 }}
              value={settings.displaySize}
              options={DISPLAY_OPTIONS}
              onChange={(value) => updateSetting('displaySize', value as DisplaySize)}
            />
          </section>
          <section>
            <Text strong>画面效果</Text>
            <Segmented
              block
              style={{ marginTop: 10 }}
              value={settings.graphicsQuality}
              options={QUALITY_OPTIONS}
              onChange={(value) => updateSetting('graphicsQuality', value as GraphicsQuality)}
            />
          </section>
          <section>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Text strong>背景音乐</Text>
              <Switch
                checked={settings.musicEnabled}
                onChange={(checked) => updateSetting('musicEnabled', checked)}
              />
            </Space>
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              音量：{settings.masterVolume}%
            </Text>
            <Slider
              min={0}
              max={100}
              value={settings.masterVolume}
              disabled={!settings.musicEnabled}
              onChange={(value) => updateSetting('masterVolume', value)}
            />
          </section>
          <section className="cover-controls-guide">
            <Text strong>基本操作</Text>
            <p>A / D 或方向键移动 · W / Space 跳跃 · J 近战 · K / F 远程 · ESC 暂停</p>
          </section>
        </Space>
      </Modal>
    </section>
  )
}
