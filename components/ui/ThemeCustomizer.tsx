'use client'

import { useEffect, useState } from 'react'
import { Button, Collapse, Input, InputNumber, Select, Space, Tag, Typography, message } from 'antd'
import { History, ListRestart, Sparkles } from 'lucide-react'
import type { ThemeCustomizerProps } from '@/types'
import { getPromptTemplates } from '@/configs/prompt-templates'
import { buildStructuredPrompt } from '@/lib/asset-catalog'
import { useUiLocale } from './LanguageSwitcher'
import { localizePromptFields, restorePromptFieldLabels } from '@/lib/ui-locale'
import CreativeWorkshop from './CreativeWorkshop'
import { templateSelection, type TemplateMode } from '@/lib/template-selection'

const { Text } = Typography
const { TextArea } = Input

const ThemeCustomizer: React.FC<ThemeCustomizerProps> = ({ creationLanguage = 'zh-CN', onCreationLanguageChange, inspiration, customThemeName, onThemeNameChange, customStory, onStoryChange, customPrompt, onPromptChange, levelCount = 3, onLevelCountChange, onOptimizePrompt, onCompleteIdea, isOptimizing = false, isAgentBusy = false, optimizedSpec, completionNotice, hasSavedDraft = false, onRestoreDraft, onTemplateApply, templateSources=[] }) => {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [workshopOpen, setWorkshopOpen] = useState(false)
  const locale = useUiLocale()
  const templates = getPromptTemplates(creationLanguage)
  useEffect(() => { if (optimizedSpec) setDetailsOpen(true) }, [optimizedSpec])
  const handleTemplateSelect = (templateId: string, mode: TemplateMode = 'complete') => {
    if (isAgentBusy || isOptimizing) return
    const template = templates.find((item) => item.id === templateId)
    if (!template) return
    const selected = templateSelection(template, mode)
    if(onTemplateApply){
      if(!onTemplateApply({...selected,language:creationLanguage,spec:null,templateSources:[]}))return
      setWorkshopOpen(false)
      return
    }
    // Resize the empty field skeleton first; the complete template prompt must
    // be the final update and must never be overwritten by the level change.
    onLevelCountChange?.(selected.levelCount)
    onThemeNameChange(selected.title)
    onStoryChange(selected.story)
    onPromptChange(selected.prompt)
    setWorkshopOpen(false)
    message.success(`已加载模板：${template.name}`)
  }
  return <>
    <div className="story-template-picker">
      <Text strong>创作语言</Text>
      <Select aria-label="创作语言" value={creationLanguage} disabled={isAgentBusy || isOptimizing} onChange={onCreationLanguageChange} style={{ width: '100%' }} options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} />
      <Text type="secondary">决定新生成的剧情、任务和游戏提示所用语言，与网页界面语言分开设置。</Text>
      <Text type="secondary">更改后需重新补全和审核；已有成品保留原样。</Text>
    </div>
    <div className="story-template-picker">
      <Text strong>从故事模板开始（可选）</Text>
      <Text type="secondary">选一个示例，会填入游戏名称、故事和关卡设定；之后都能修改。</Text>
      <Button block disabled={isAgentBusy || isOptimizing} onClick={() => setWorkshopOpen(true)}>打开创意工坊</Button>
      <Text type="secondary">选择模板会替换当前名称、故事和详细设定。</Text>
    </div>
    <CreativeWorkshop open={workshopOpen} language={creationLanguage} busy={isAgentBusy || isOptimizing} draftKey={JSON.stringify([customThemeName,customStory,customPrompt,levelCount,creationLanguage])} onClose={() => setWorkshopOpen(false)} onSelect={handleTemplateSelect} onApply={selection=>{if(isAgentBusy || isOptimizing || !onTemplateApply || !onTemplateApply(selection))return false;setDetailsOpen(!!selection.spec);setWorkshopOpen(false);return true}} />
    {templateSources.length>0 && <div className="story-template-picker" data-no-ui-translation><Text strong>{locale==='en'?'Template Attribution':'模板来源署名'}</Text>{templateSources.map(source=><a key={`${source.postId}:${source.revision}`} href={`/community?game=${source.postId}`} target="_blank" rel="noopener noreferrer">{source.authorName}</a>)}<Text type="secondary">{locale==='en'?'Attribution is retained in the new GameSpec and export. Review and approve the new work before creating artwork.':'新作品的GameSpec和导出会保留署名，制作素材前仍需重新审核批准。'}</Text></div>}
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
    <div className="structured-prompt-section">
      <div className="structured-prompt-heading">
        <Text strong>详细设定（可选）</Text>
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
        disabled={!customThemeName.trim() || !customStory.trim() || isAgentBusy || isOptimizing}
        title="补全空白字段并建立 GameSpec V3"
      >
        一键补全并优化提示词
      </Button>
      <Text type="secondary" role="status" style={{ display: 'block', marginBottom: 8, fontSize: 11 }}>
        {!customThemeName.trim() || !customStory.trim()
          ? '请先填写游戏名称和故事。'
          : isAgentBusy
            ? 'Agent 正在处理任务，请等待结束后再补全设定。'
            : isOptimizing
              ? '正在补全设定，完成后会显示在下方。'
              : '使用已选择的文字模型补全；未配置模型时生成本地草案。补全后可在下方检查，再进入 AI 策划。'}
      </Text>
      {completionNotice}
      <Collapse size="small" activeKey={detailsOpen ? ['fields'] : []} onChange={(keys) => setDetailsOpen(keys.includes('fields'))} items={[{ key: 'fields', label: '编辑完整设定字段（可选）', children: <>
      <TextArea value={localizePromptFields(customPrompt, locale)} onChange={(event) => onPromptChange(locale === 'en' ? restorePromptFieldLabels(event.target.value, customPrompt) : event.target.value)} rows={18} placeholder="请在各字段冒号后填写；不需要的项目可以留空。" style={{ width: '100%', fontSize: 12, lineHeight: 1.7 }} />
      <div className="prompt-writing-help"><strong>怎么填写</strong><span>在字段冒号后写具体画面或玩法；不确定的留空。</span><small>主角：戴蓝披风的骑士，侧视像素风</small><small>关卡 1 背景：黄昏森林，留出行走区域</small><small>可选补充主角目标、难度、叙事节奏和角色外观要求。</small></div>
      <Text type="secondary" style={{ fontSize: 12 }}>保留需要的描述，其余字段可以留空。后续补全与评审会围绕你填写的要求继续。</Text>
      </> }]} />
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
