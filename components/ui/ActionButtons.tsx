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
  allowWithoutApiKey = false,
  showCreateButton = true,
  onCreateTheme,
  onStartGame
}) => {
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {showCreateButton && <Button
        type="default"
        size="large"
        icon={!isThemeCreated ? <Sparkles size={16} /> : <RotateCcw size={16} />}
        onClick={onCreateTheme}
        loading={isLoading}
        style={{ width: '100%', height: '48px' }}
        disabled={
          (!allowWithoutApiKey && !apiKey.trim()) ||
          (customThemeName.trim() || customPrompt.trim()
            ? !customThemeName.trim() || !customPrompt.trim()
            : !selectedTheme)
        }
      >
        {!isThemeCreated ? '生成所选素材' : '重新生成所选素材'}
      </Button>}
      <Button
        type="primary"
        size="large"
        icon={<PlayCircleOutlined />}
        onClick={onStartGame}
        style={{ width: '100%', height: '48px' }}
        disabled={!selectedTheme}
      >
        试玩我的游戏
      </Button>
    </Space>
  )
}

export default ActionButtons
