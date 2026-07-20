'use client'

import { Typography } from 'antd'
import CurvedLoop from './CurvedLoop'
import ScrambledText from './ScrambleText'
import { ProjectHeaderProps } from '@/types'

const { Title } = Typography

const ProjectHeader: React.FC<ProjectHeaderProps> = ({ className }) => {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginBottom: '50px'
      }}
    >
      <Title level={3} style={{ margin: 0, color: '#1890ff', fontSize: '20px' }}></Title>
      <ScrambledText
        className="scrambled-text-demo"
        radius={100}
        duration={1.2}
        speed={0.5}
        scrambleChars={':.'}
      >
        PIXEL WORLD
      </ScrambledText>
      <CurvedLoop marqueeText="Prompt Play · 提示即玩 ✦ Type a theme, play a pixel world ✦ AI 生成像素关卡，立刻开玩 ✦" />
      <p style={{
        fontSize: '12px',
        color: '#888',
        textAlign: 'center',
        marginTop: '12px',
        lineHeight: 1.6,
        maxWidth: '320px',
      }}>
        Powered by <strong style={{ color: '#1890ff' }}>Prompt Play</strong> — 由提示词驱动的像素世界。
        <br />
        Pick a theme or write a prompt, AI generates your world and you play instantly.
      </p>
    </div>
  )
}

export default ProjectHeader