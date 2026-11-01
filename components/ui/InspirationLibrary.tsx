'use client'

import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { Check, Plus, RefreshCw, Sparkles } from 'lucide-react'
import { INSPIRATION_PACKS, type InspirationTarget } from '@/configs/inspiration-packs'
import { translateUiText } from '@/lib/ui-locale'

export type { InspirationTarget } from '@/configs/inspiration-packs'

interface InspirationLibraryProps {
  creationLanguage?: 'zh-CN' | 'en'
  story: string
  prompt: string
  onApply: (target: InspirationTarget, text: string) => void
}

function packForContent(content: string, language?: 'zh-CN' | 'en'): number {
  return INSPIRATION_PACKS.findIndex((pack) => pack.ideas.some((idea) => idea.variants.some((text) => content.includes(text) || (language === 'en' && content.includes(translateUiText(text) || text)))))
}

export default function InspirationLibrary({ story, prompt, onApply, creationLanguage = 'zh-CN' }: InspirationLibraryProps) {
  const selected = (text: string) => story.includes(text) || prompt.includes(text) || (creationLanguage === 'en' && `${story}\n${prompt}`.includes(translateUiText(text) || text))
  const [packIndex, setPackIndex] = useState(() => Math.max(0, packForContent(`${story}\n${prompt}`, creationLanguage)))
  const [variantIndex, setVariantIndex] = useState(0)
  const selectedPack = packForContent(`${story}\n${prompt}`, creationLanguage)

  useEffect(() => {
    if (selectedPack >= 0 && selectedPack !== packIndex) { setPackIndex(selectedPack); setVariantIndex(0) }
  }, [selectedPack, packIndex])

  const pack = INSPIRATION_PACKS[packIndex]
  const lockedToPack = selectedPack >= 0
  const chosen = pack.ideas.flatMap((idea) => idea.variants).filter(selected)

  const refresh = () => {
    if (lockedToPack) setVariantIndex((index) => 1 - index)
    else { setPackIndex((index) => (index + 1) % INSPIRATION_PACKS.length); setVariantIndex(0) }
  }

  return <section className="inspiration-library" aria-label="灵感与主题库">
    <div className="inspiration-library-heading">
      <span className="inspiration-library-icon"><Sparkles size={17} /></span>
      <div><strong>灵感与主题库 · {pack.name}</strong><small>{lockedToPack ? '已加入的灵感会进入 AI 策划与评审；刷新只换同一主题的细节' : '同一组灵感可以搭配使用；刷新可换一组主题'}</small></div>
      <Button className="inspiration-refresh" size="small" icon={<RefreshCw size={13} />} onClick={refresh}>{lockedToPack ? '刷新同主题' : '刷新灵感'}</Button>
    </div>
    <div className="inspiration-grid">
      {pack.ideas.map((idea) => {
        const text = idea.variants[variantIndex]
        const applied = selected(text)
        return <article className={`inspiration-card tone-${idea.tone}`} key={`${pack.id}-${idea.kind}`}>
          <span className="inspiration-kind">{idea.kind}</span>
          <p>{text}</p>
          <Button type="text" size="small" disabled={applied} icon={applied ? <Check size={13} /> : <Plus size={13} />} onClick={() => onApply(idea.target, text)}>{applied ? '已加入' : `加入${idea.target === 'style' ? '画风' : '故事'}`}</Button>
        </article>
      })}
    </div>
    {chosen.length > 0 && <p className="inspiration-selected">已选 {chosen.length} 条：会随名称、故事和详细设定一起交给 AI 评审。</p>}
  </section>
}
