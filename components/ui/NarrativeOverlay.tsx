'use client'

import { useEffect, useMemo, useRef } from 'react'
import { createGameTranslator } from '@/lib/game-language'
import type { StoryEntry } from '@/lib/narrative-runtime'

export default function NarrativeOverlay({ creationLanguage, queue, history, logOpen, onSkip, onClose, onOpen }: { creationLanguage?: 'zh-CN' | 'en'; queue: StoryEntry[]; history: StoryEntry[]; logOpen: boolean; onSkip: () => void; onClose: () => void; onOpen: () => void }) {
  const t = useMemo(() => createGameTranslator(creationLanguage), [creationLanguage])
  const current = queue[queue.length - 1]
  const dismiss = useRef(onSkip)
  useEffect(() => { dismiss.current = onSkip }, [onSkip])
  useEffect(() => {
    if (!current || logOpen) return
    const timer = window.setTimeout(() => dismiss.current(), 12_000)
    return () => window.clearTimeout(timer)
  }, [current?.id, logOpen])
  const en = creationLanguage === 'en'
  return <section data-no-ui-translation lang={creationLanguage || 'zh-CN'} className={'narrative-panel' + (logOpen ? ' is-reading' : current ? ' has-notice' : ' is-quiet')} aria-label={logOpen ? t('剧情记录') : t('当前剧情')}>
    <header className="narrative-heading"><span className="narrative-sigil" aria-hidden="true">◇</span><span className="narrative-eyebrow">{logOpen ? en ? 'STORY ARCHIVE' : '旅途手记' : current ? en ? 'ON THE JOURNEY' : '旅途旁白' : en ? 'YOUR JOURNEY' : '故事仍在继续'}</span><span className="narrative-chapter">{current?.title}</span><button className="narrative-link" onPointerDown={event => event.preventDefault()} onClick={logOpen ? onClose : onOpen}>{logOpen ? t('关闭记录') : en ? 'Read story' : '回看故事'}<span aria-hidden="true">{logOpen ? ' −' : ' ↗'}</span></button></header>
    {logOpen ? <div className="narrative-panel-body narrative-archive">{history.length ? history.map((entry,index) => <article key={entry.id}><span className="narrative-entry-number">{String(index+1).padStart(2,'0')}</span><div><h3>{entry.title}</h3><p>{entry.text}</p></div></article>) : <p>{t('还没有新的剧情记录。')}</p>}</div> : current && <div key={current.id} className="narrative-notice"><p>{current.text}</p><button className="narrative-dismiss" aria-label={en ? 'Dismiss notice' : '收起提示'} onPointerDown={event => event.preventDefault()} onClick={onSkip}>×</button><span className="narrative-reading-line" aria-hidden="true"/></div>}
  </section>
}
