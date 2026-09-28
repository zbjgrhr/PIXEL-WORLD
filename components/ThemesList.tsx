'use client'

import React, { forwardRef } from 'react'
import { Select } from 'antd'
import type { GameTheme, ThemesListProps } from '@/types'

const ThemesList = forwardRef<HTMLDivElement, ThemesListProps>(({ themes, selectedTheme, onThemeSelect }, ref) => (
  <div ref={ref} className="workspace-project-switcher">
    <div className="workspace-project-label"><strong>已创建的游戏</strong><span>选择一个，在右栏查看和试玩</span></div>
    <Select<GameTheme>
      aria-label="选择游戏"
      value={themes.some((theme) => theme.id === selectedTheme) ? selectedTheme : undefined}
      placeholder="选择自己的游戏"
      onChange={onThemeSelect}
      options={themes.map((theme) => ({ value: theme.id, label: theme.name, disabled: Boolean(theme.isLoading) }))}
      style={{ width: '100%' }}
    />
  </div>
))

ThemesList.displayName = 'ThemesList'
export default ThemesList
