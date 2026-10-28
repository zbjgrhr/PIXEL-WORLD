'use client'

import { Button } from 'antd'
import { useEffect, useRef } from 'react'
import type { StoryEntry } from '@/lib/narrative-runtime'

export default function NarrativeOverlay({ queue, history, logOpen, onNext, onSkip, onClose }: { queue: StoryEntry[]; history: StoryEntry[]; logOpen: boolean; onNext: () => void; onSkip: () => void; onClose: () => void }) {
  const current = queue[0]
  const dialogRef = useRef<HTMLElement>(null)
  const visible = Boolean(current || logOpen)
  useEffect(() => {
    if (!visible) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [visible])
  if (!current && !logOpen) return null
  return <div className="narrative-shade" role="dialog" aria-modal="true" aria-label={logOpen ? '剧情记录' : '当前剧情'} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (logOpen) onClose(); else onSkip() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])
      const next = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === next || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); next?.focus() }
    }
  }}>
    <section ref={dialogRef} className="narrative-dialog" tabIndex={-1}>
      <header><small>PIXEL WORLD · 冒险故事</small><h2>{logOpen ? '剧情记录' : current.title}</h2></header>
      <div className="narrative-dialog-body">{logOpen ? history.length ? history.map(entry => <article key={entry.id}><h3>{entry.title}</h3><p>{entry.text}</p></article>) : <p>还没有新的剧情记录。</p> : <p>{current.text}</p>}</div>
      <footer>{logOpen ? <Button type="primary" onClick={onClose}>关闭记录，返回游戏</Button> : <><Button onClick={onSkip}>跳过本段剧情</Button><Button type="primary" onClick={onNext}>{queue.length > 1 ? '继续阅读' : '继续冒险'}</Button></>}</footer>
    </section>
  </div>
}
