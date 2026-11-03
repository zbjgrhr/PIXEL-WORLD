'use client'

import React from 'react'
import type { ProjectHeaderProps } from '@/types'
import LanguageSwitcher from './LanguageSwitcher'

const NAV_ITEMS = [
  { section: 'home', label: '世界主页', href: '#world-home' },
  { section: 'projects', label: '本地项目库', href: '/projects' },
  { section: 'community', label: '创意工坊', href: '/community' },
]

type HeaderProps = ProjectHeaderProps & {
  projectNote?: string
  projectError?: boolean
  onOpenProjects?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  activeSection?: 'home' | 'projects' | 'community'
  spatialPreview?: boolean
}

const ProjectHeader: React.FC<HeaderProps> = ({ className, projectNote, projectError, onOpenProjects, activeSection = 'home' }) => (
  <header className={`${className || ''} portal-header`}>
    <LanguageSwitcher />
    <div className="portal-header-copy">
      <span className="portal-eyebrow">PROMPT PLAY · 像素世界制作器</span>
      <h1>PIXEL WORLD</h1>
      <p>写下一个世界，生成它，然后真正走进去。</p>
    </div>

    <div className="portal-world-note">
      <strong>WORLD NOTE</strong>
      <span role={projectNote ? projectError ? 'alert' : 'status' : undefined}>{projectNote || '你的提示词、关卡与素材共同组成这个世界。'}</span>
    </div>

    <nav className="space-theme-nav" aria-label="Pixel World sections">
      {NAV_ITEMS.map((item) => (
        <a className={activeSection === item.section ? 'is-active' : ''} aria-current={activeSection === item.section ? 'page' : undefined} href={activeSection !== 'home' && item.href.startsWith('#') ? `/${item.href}` : item.href} key={item.href} onClick={item.href === '/projects' ? onOpenProjects : undefined}>{item.label}</a>
      ))}
    </nav>
  </header>
)

export default ProjectHeader
