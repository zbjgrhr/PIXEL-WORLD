'use client'

import { Button, Collapse, Input, InputNumber, Select, Space, Tag, Typography, message } from 'antd'
import { History, ListRestart, Sparkles } from 'lucide-react'
import type { ThemeCustomizerProps } from '@/types'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { buildStructuredPrompt } from '@/lib/asset-catalog'

const { Text } = Typography
const { TextArea } = Input

const ThemeCustomizer: React.FC<ThemeCustomizerProps> = ({ customThemeName, onThemeNameChange, customPrompt, onPromptChange, levelCount = 3, onLevelCountChange, onOptimizePrompt, isOptimizing = false, optimizedSpec, hasSavedDraft = false, onRestoreDraft }) => {
  const handleTemplateSelect = (templateId: string) => {
    const template = PROMPT_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    // Resize the empty field skeleton first; the complete template prompt must
    // be the final update and must never be overwritten by the level change.
    onLevelCountChange?.(template.levelCount)
    onThemeNameChange(template.themeName)
    onPromptChange(template.prompt)
    message.success(`已加载模板：${template.name}`)
  }
  return <>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Prompt Template / 提示词模板</Text>
      <Select placeholder="选择完整示例模板" style={{ width: '100%' }} allowClear onChange={(value) => value && handleTemplateSelect(value)} options={PROMPT_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))} />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Game Name / 游戏名称</Text>
      <Input value={customThemeName} onChange={(event) => onThemeNameChange(event.target.value)} placeholder="例如：龙之城堡" />
    </div>
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }} wrap>
        <Text strong>Structured Prompt / 结构化游戏构想</Text>
        <Space>
          {hasSavedDraft && onRestoreDraft && <Button size="small" icon={<History size={14} />} onClick={onRestoreDraft}>恢复上次草稿</Button>}
          <Button size="small" icon={<ListRestart size={14} />} onClick={() => onPromptChange(buildStructuredPrompt(levelCount))}>恢复完整字段</Button>
          <Button type="primary" ghost size="small" icon={<Sparkles size={14} />} onClick={onOptimizePrompt} loading={isOptimizing} disabled={!customPrompt.trim()}>一键优化提示词</Button>
        </Space>
      </Space>
      <TextArea value={customPrompt} onChange={(event) => onPromptChange(event.target.value)} rows={18} placeholder="请在各字段冒号后填写；不需要的项目可以留空。" style={{ width: '100%', fontSize: 12, lineHeight: 1.7 }} />
      <Text type="secondary" style={{ fontSize: 12 }}>保留需要的描述，其余字段留空；一键优化只补全空白或不足的字段。</Text>
    </div>
    {optimizedSpec && <Collapse size="small" items={[{
      key: 'optimized-spec',
      label: <Space><Sparkles size={14} /><Text strong>V3 规划：{optimizedSpec.title}</Text></Space>,
      children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div><Tag color="blue">主角</Tag>{optimizedSpec.hero.name}</div>
        <div><Tag color="purple">战斗</Tag>{optimizedSpec.weapon.mode}</div>
        <div><Tag color="red">素材</Tag>{optimizedSpec.assets.length} 项</div>
        <div><Tag color="green">关卡</Tag>{optimizedSpec.levels.length} 关</div>
        <Text type="secondary">下一步可在素材规划中关闭不需要的内容并选择出现关卡。</Text>
      </Space>,
    }]} />}
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Level Count / 关卡数量</Text>
      <InputNumber value={levelCount} onChange={(value) => onLevelCountChange?.(value || 1)} min={1} max={10} style={{ width: '100%' }} />
      <Text type="secondary" style={{ fontSize: 12 }}>每关拥有独立背景、音乐和画面特效；最后一关默认包含 Boss。</Text>
    </div>
  </>
}

export default ThemeCustomizer
