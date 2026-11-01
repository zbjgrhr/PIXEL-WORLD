'use client'

import { Button, Drawer, Tag } from 'antd'
import { getPromptTemplates } from '@/configs/prompt-templates'
import { templateSelection, type TemplateMode } from '@/lib/template-selection'
import type { CreationLanguage,TemplateReuseSelection } from '@/types'
import ReviewedTemplateLibrary from './ReviewedTemplateLibrary'
import {useUiLocale} from './LanguageSwitcher'

interface Props {
  open: boolean
  language: CreationLanguage
  busy: boolean
  onClose: () => void
  onSelect: (id: string, mode: TemplateMode) => void
  onApply?: (selection:TemplateReuseSelection) => boolean
  draftKey?:string
}

export default function CreativeWorkshop({ open, language, busy, onClose, onSelect, onApply,draftKey='' }: Props) {
  const en=useUiLocale()==='en'
  return <Drawer title="创意工坊" open={open} onClose={onClose} width={760} rootClassName="creative-workshop">
    <ReviewedTemplateLibrary language={language} open={open} busy={busy} onApply={onApply} draftKey={draftKey} />
    <h3>{en?'Starter Examples':'示例设定'}</h3>
    <p className="workshop-intro">先看故事，再选择创作起点。示例设定尚未作为成品通过完整验收。</p>
    <p className="workshop-intro">只用故事会清空详细设定；沿用完整设定会同时填入角色、美术和关卡要求。两种方式都需要重新补全和审核。</p>
    <div className="workshop-grid">
      {getPromptTemplates(language).map((template, index) => <article className="workshop-card" key={`${language}-${template.id}`}>
        <div className="workshop-card-heading"><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><Tag>{language === 'en' ? 'English' : '简体中文'}</Tag></div>
        <h3 data-no-ui-translation>{template.themeName}</h3>
        <Tag>示例设定</Tag>
        <Tag>{language === 'en' ? `${template.levelCount} levels` : `${template.levelCount} 关`}</Tag>
        <p data-no-ui-translation>{templateSelection(template, 'story').story}</p>
        <div className="workshop-actions">
          <Button disabled={busy} onClick={() => onSelect(template.id, 'story')}>只用故事</Button>
          <Button type="primary" disabled={busy} onClick={() => onSelect(template.id, 'complete')}>沿用完整设定</Button>
        </div>
      </article>)}
    </div>
    <Button href="/community" style={{ marginTop: 20 }}>查看玩家作品与实验</Button>
  </Drawer>
}
