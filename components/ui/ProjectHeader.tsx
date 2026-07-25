'use client'

import React from 'react'
import type { ProjectHeaderProps } from '@/types'

const NAV_ITEMS = [
  { label: '世界主页', href: '#world-home' },
  { label: '游戏构想', href: '#game-idea' },
  { label: '素材工坊', href: '#asset-workshop' },
  { label: 'Agent Studio', href: '#agent-studio' },
  { label: '预览与发布', href: '#preview-publish' },
]

const ProjectHeader: React.FC<ProjectHeaderProps> = ({ className }) => (
  <header className={`${className || ''} portal-header`}>
    <div className="portal-header-copy">
      <span className="portal-eyebrow">PROMPT PLAY · 像素世界制作器</span>
      <h1>PIXEL WORLD</h1>
      <p>写下一个世界，生成它，然后真正走进去。</p>
    </div>

    <div className="portal-world-note">
      <strong>WORLD NOTE</strong>
      <span>你的提示词、关卡与素材共同组成这个世界。</span>
    </div>

    <nav className="space-theme-nav" aria-label="Pixel World sections">
      {NAV_ITEMS.map((item, index) => (
        <a className={index === 0 ? 'is-active' : ''} href={item.href} key={item.href}>{item.label}</a>
      ))}
    </nav>
  </header>
)

export default ProjectHeader
