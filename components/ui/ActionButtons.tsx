'use client'

import { Button, Space } from 'antd'
import { PlayCircleOutlined } from '@ant-design/icons'
import { Sparkles, RotateCcw } from 'lucide-react'
import { ActionButtonsProps } from '@/types'

const ActionButtons: React.FC<ActionButtonsProps> = ({
  isThemeCreated,
  isLoading,
  selectedTheme,
  customPrompt,
  customThemeName,
  apiKey,
  onCreateTheme,
  onStartGame
}) => {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Button
        type="default"
        size="large"
        icon={!isThemeCreated ? <Sparkles size={16} /> : <RotateCcw size={16} />}
        onClick={onCreateTheme}
        loading={isLoading}
        style={{ width: '100%', height: '48px' }}
        disabled={
          !apiKey.trim() ||
          (customThemeName.trim() || customPrompt.trim()
            ? !customThemeName.trim() || !customPrompt.trim()
            : !selectedTheme)
        }
      >
        {!isThemeCreated ? 'Create Theme' : 'Reset'}
      </Button>
      <Button
        type="primary"
        size="large"
        icon={<PlayCircleOutlined />}
        onClick={onStartGame}
        style={{ width: '100%', height: '48px' }}
        disabled={!selectedTheme}
      >
        Start Game
      </Button>
    </Space>
  )
}

export default ActionButtons