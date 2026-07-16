'use client'

import { Button, Collapse, Input, InputNumber, Select, Space, Tag, Typography, message } from 'antd'
import { Sparkles } from 'lucide-react'
import type { ThemeCustomizerProps } from '@/types'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'

const { Text } = Typography
const { TextArea } = Input

const ThemeCustomizer: React.FC<ThemeCustomizerProps> = ({
  customThemeName,
  onThemeNameChange,
  customPrompt,
  onPromptChange,
  levelCount,
  onLevelCountChange,
  onOptimizePrompt,
  isOptimizing = false,
  optimizedSpec,
}) => {
  const handleTemplateSelect = (templateId: string) => {
    const template = PROMPT_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    onThemeNameChange(template.themeName)
    onPromptChange(template.prompt)
    onLevelCountChange?.(template.levelCount)
    message.success(`已加载模板：${template.name}`)
  }

  return (
    <>
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Prompt Template / 提示词模板</Text>
        <Select
          placeholder="选择集成模板一键填充"
          style={{ width: '100%' }}
          allowClear
          onChange={(value) => value && handleTemplateSelect(value)}
          options={PROMPT_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))}
        />
      </div>

      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Custom Theme Name / 主题名称</Text>
        <Input
          value={customThemeName}
          onChange={(event) => onThemeNameChange(event.target.value)}
          placeholder="例如：Japanese Moonlit World"
        />
      </div>

      <div>
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text strong>Custom Prompt / 游戏构想</Text>
          <Button
            type="primary"
            ghost
            size="small"
            icon={<Sparkles size={14} />}
            onClick={onOptimizePrompt}
            loading={isOptimizing}
            disabled={!customPrompt.trim()}
          >
            一键优化提示词
          </Button>
        </Space>
        <TextArea
          value={customPrompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="描述世界、主角、敌人、武器、地面、障碍物和关卡；系统会自动拆分为互不污染的素材提示词。"
          rows={12}
          style={{ width: '100%', fontSize: 12 }}
        />
      </div>

      {optimizedSpec && (
        <Collapse
          size="small"
          items={[{
            key: 'optimized-spec',
            label: <Space><Sparkles size={14} /><Text strong>已结构化：{optimizedSpec.title}</Text></Space>,
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div><Tag color="blue">主角</Tag>{optimizedSpec.hero.name}</div>
                <div><Tag color="purple">武器</Tag>{optimizedSpec.weapon.name} · {optimizedSpec.weapon.mode}</div>
                <div><Tag color="red">敌人</Tag>{optimizedSpec.enemies.map((item) => item.name).join('、')}</div>
                <div><Tag color="volcano">Boss</Tag>{optimizedSpec.boss.name}</div>
                <div><Tag color="green">收集品</Tag>{optimizedSpec.collectible.name}</div>
                <Text type="secondary">{optimizedSpec.levels.length} 个关卡；生成时每类素材只接收自己的专用描述。</Text>
              </Space>
            ),
          }]}
        />
      )}

      <div>
        <Text strong style={{ display: 'block', marginBottom: 8 }}>Level Count / 关卡数量</Text>
        <InputNumber
          value={levelCount}
          onChange={(value) => onLevelCountChange?.(value || 1)}
          min={1}
          max={10}
          style={{ width: '100%' }}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
          每关会生成独立背景、地面和障碍物；最后一关固定包含 Boss。
        </Text>
      </div>
    </>
  )
}

export default ThemeCustomizer
