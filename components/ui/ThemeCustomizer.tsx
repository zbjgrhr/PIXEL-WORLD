'use client'

import { Alert, Button, Collapse, Input, InputNumber, Segmented, Select, Space, Tag, Typography, message } from 'antd'
import { History, ListRestart, Sparkles } from 'lucide-react'
import type { ThemeCustomizerProps } from '@/types'
import { PROMPT_TEMPLATES } from '@/configs/prompt-templates'
import { buildStructuredPrompt } from '@/lib/asset-catalog'

const { Text } = Typography
const { TextArea } = Input

function templateStory(prompt: string): string {
  return prompt.match(/^背景故事：\s*(.+)$/m)?.[1]?.trim() || ''
}

const ThemeCustomizer: React.FC<ThemeCustomizerProps> = ({ creationMode = 'agent', onCreationModeChange, customThemeName, onThemeNameChange, customStory, onStoryChange, customPrompt, onPromptChange, levelCount = 3, onLevelCountChange, onOptimizePrompt, isOptimizing = false, optimizedSpec, hasSavedDraft = false, onRestoreDraft }) => {
  const handleTemplateSelect = (templateId: string) => {
    const template = PROMPT_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    // Resize the empty field skeleton first; the complete template prompt must
    // be the final update and must never be overwritten by the level change.
    onLevelCountChange?.(template.levelCount)
    onThemeNameChange(template.themeName)
    onStoryChange(templateStory(template.prompt))
    onPromptChange(template.prompt)
    message.success(`已加载模板：${template.name}`)
  }
  return <>
    <div className="story-template-picker">
      <Text strong>从故事模板开始（可选）</Text>
      <Text type="secondary">选一个示例，会填入游戏名称、故事和关卡设定；之后都能修改。</Text>
      <Select aria-label="选择故事模板" placeholder="选择故事模板" style={{ width: '100%' }} allowClear onChange={(value) => value && handleTemplateSelect(value)} options={PROMPT_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))} />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>游戏名称 <Text type="danger">*</Text></Text>
      <Input required value={customThemeName} onChange={(event) => onThemeNameChange(event.target.value)} placeholder="例如：龙之城堡" />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>游戏故事 <Text type="danger">*</Text></Text>
      <TextArea
        required
        value={customStory}
        onChange={(event) => onStoryChange(event.target.value)}
        rows={4}
        placeholder="写下主角、目标、主要冲突与结局方向。一键优化和 Agent 集群都会围绕游戏名称与这段故事展开。"
        style={{ width: '100%', lineHeight: 1.65 }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>这部分属于你的核心设定，优化和评审只会补充细节，不会擅自改写主题。</Text>
    </div>
    {inspiration}
    <Button className="idea-next-button" type="primary" block disabled={!customThemeName.trim() || !customStory.trim()} onClick={onCompleteIdea}>完成故事，进入 AI 策划 →</Button>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>策划方式</Text>
      <Segmented
        block
        value={creationMode}
        onChange={(value) => onCreationModeChange?.(value as 'agent' | 'classic')}
        options={[
          { value: 'agent', label: 'Agent 集群（推荐）' },
          { value: 'classic', label: '传统单次优化' },
        ]}
      />
      {creationMode === 'agent' && <Alert type="info" showIcon message="多个专业 Agent 会先策划、交叉评审并修正规格；你批准后才会开放图片生成。" style={{ marginTop: 8 }} />}
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Prompt Template / 提示词模板</Text>
      <Select placeholder="选择完整示例模板" style={{ width: '100%' }} allowClear onChange={(value) => value && handleTemplateSelect(value)} options={PROMPT_TEMPLATES.map((item) => ({ value: item.id, label: item.name }))} />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Game Name / 游戏名称</Text>
      <Input value={customThemeName} onChange={(event) => onThemeNameChange(event.target.value)} placeholder="例如：龙之城堡" />
    </div>
    <div>
      <Text strong style={{ display: 'block', marginBottom: 8 }}>Story / 故事</Text>
      <TextArea
        value={customStory}
        onChange={(event) => onStoryChange(event.target.value)}
        rows={4}
        placeholder="写下主角、目标、主要冲突与结局方向。一键优化和 Agent 集群都会围绕游戏名称与这段故事展开。"
        style={{ width: '100%', lineHeight: 1.65 }}
      />
      <Text type="secondary" style={{ fontSize: 12 }}>这部分属于你的核心设定，优化和评审只会补充细节，不会擅自改写主题。</Text>
    </div>
    <div className="structured-prompt-section">
      <div className="structured-prompt-heading">
        <Text strong>Structured Prompt / 结构化游戏构想</Text>
        <Space wrap size={6}>
          {hasSavedDraft && onRestoreDraft && <Button size="small" icon={<History size={14} />} onClick={onRestoreDraft}>恢复上次草稿</Button>}
          <Button size="small" icon={<ListRestart size={14} />} onClick={() => onPromptChange(buildStructuredPrompt(levelCount))}>恢复完整字段</Button>
        </Space>
      </div>
      <Button
        className="prompt-optimize-button"
        type="primary"
        ghost
        block
        icon={<Sparkles size={15} />}
        onClick={onOptimizePrompt}
        loading={isOptimizing}
        title="补全空白字段、优化已有描述并建立可供 Agent 评审的 GameSpec V3"
      >
        一键补全并优化提示词
      </Button>
      <TextArea value={customPrompt} onChange={(event) => onPromptChange(event.target.value)} rows={18} placeholder="请在各字段冒号后填写；不需要的项目可以留空。" style={{ width: '100%', fontSize: 12, lineHeight: 1.7 }} />
      <div className="prompt-writing-help"><strong>怎么填写</strong><span>在字段冒号后写具体画面或玩法；不确定的留空。</span><small>主角：戴蓝披风的骑士，侧视像素风</small><small>关卡 1 背景：黄昏森林，留出行走区域</small></div>
      <Text type="secondary" style={{ fontSize: 12 }}>{creationMode === 'agent' ? '保留你明确填写的要求；Agent 只补充空白、消除冲突，不会覆盖你的核心设定。' : '保留需要的描述，其余字段留空；一键优化只补全空白或不足的字段。'}</Text>
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
      <Text strong style={{ display: 'block', marginBottom: 8 }}>关卡数量</Text>
      <InputNumber value={levelCount} onChange={(value) => onLevelCountChange?.(value || 1)} min={1} max={10} style={{ width: '100%' }} />
      <Text type="secondary" style={{ fontSize: 12 }}>每关拥有独立背景、音乐和画面特效；最后一关默认包含 Boss。</Text>
    </div>
  </>
}

export default ThemeCustomizer
