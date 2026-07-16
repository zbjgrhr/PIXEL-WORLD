import type { Metadata } from 'next'
import './globals.css'
import { AppProviders } from '@/components/AppProviders'

export const metadata: Metadata = {
  title: 'Pixel World · Prompt to Play',
  description: '输入一个游戏构想，生成隔离的像素素材、战斗角色与可玩的多关卡世界。',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
