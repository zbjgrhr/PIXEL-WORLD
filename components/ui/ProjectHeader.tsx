'use client'

import React from 'react'
import type { ProjectHeaderProps } from '@/types'
import LanguageSwitcher from './LanguageSwitcher'

const NAV_ITEMS = [
  { label: '世界主页', href: '#world-home' },
  { label: '预览与发布', href: '#preview-publish' },
  { label: '项目库', href: '/projects' },
]

type HeaderProps = ProjectHeaderProps & {
  projectNote?: string
  projectError?: boolean
  onOpenProjects?: (event: React.MouseEvent<HTMLAnchorElement>) => void
  activeSection?: 'home' | 'projects'
  spatialPreview?: boolean
}

const ProjectHeader: React.FC<HeaderProps> = ({ className, projectNote, projectError, onOpenProjects, activeSection = 'home', spatialPreview }) => (
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
      {NAV_ITEMS.map((item, index) => (
        <a className={(activeSection === 'projects' ? item.href === '/projects' : index === 0) ? 'is-active' : ''} href={activeSection === 'projects' && item.href.startsWith('#') ? `/${item.href}` : spatialPreview && item.href === '#preview-publish' ? '#preview-publish-spatial' : item.href} key={item.href} onClick={item.href === '/projects' ? onOpenProjects : undefined}>{item.label}</a>
      ))}
    </nav>
  </header>
)

export default ProjectHeader
