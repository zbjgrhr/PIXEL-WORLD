'use client'

import type { CSSProperties } from 'react'
import { Button } from 'antd'
import { ExternalLink, Sparkles } from 'lucide-react'
import { isLocalAgentProvider, localProviderConfig } from '@/lib/agents/config'
import type { AgentProviderId } from '@/types'

export const READY_AGENT_VISUALS: Record<string, { color: string; soft: string; note: string; benefit: string }> = {
  ollama: { color: '#7856e7', soft: '#f2eeff', note: '命令行本机', benefit: '适合在自己的电脑上运行文字 Agent' },
  lmstudio: { color: '#168d81', soft: '#eaf8f3', note: '图形界面', benefit: '在图形界面下载并加载模型' },
  gpt4all: { color: '#ef8b23', soft: '#fff3e6', note: '图形界面', benefit: '另一种本机模型图形界面选择' },
  jan: { color: '#b55bd7', soft: '#f9efff', note: '图形界面', benefit: '开源的本机文字模型工具' },
  webllm: { color: '#1887d1', soft: '#edf6ff', note: '浏览器运行', benefit: '无需安装桌面软件，首次需下载模型' },
}

export default function ReadyAgentGuide({ provider }: { provider: AgentProviderId }) {
  const visual = READY_AGENT_VISUALS[provider]
  if (!visual) return null
  const local = isLocalAgentProvider(provider) ? localProviderConfig(provider) : null
  const name = local?.label || '文字 Agent'
  const style = { '--platform-accent': visual.color, '--platform-soft': visual.soft } as CSSProperties
  return <div className="selected-platform-guide ai-ready-guide" style={style}>
    <div className="selected-platform-topline">
      <span className="api-platform-badge"><span className="api-platform-dot" />{name}</span>
      <span className="ai-ready-mode">{visual.note}</span>
    </div>
    <p className="platform-slogan">{visual.benefit}。{local?.instructions}</p>
    {local ? <>
      <div className="platform-strengths"><span><Sparkles size={11} />{provider === 'webllm' ? '检查浏览器与 WebGPU' : '检查本机服务与模型'}</span><span><Sparkles size={11} />{provider === 'webllm' ? '准备模型并查看下载进度' : '先加载模型，再做短文字测试'}</span><span><Sparkles size={11} />通过后再启动策划</span></div>
      <p className="ai-ready-caution">{provider === 'webllm' ? '首次模型下载依赖浏览器网络与 WebGPU；准备超过 30 秒会提示你改用其他方案，不会无限测试。' : '连接测试只生成很短的文字；完整 GameSpec 会在你主动启动 Agent 后才生成。'}</p>
      <Button size="small" href={local.downloadUrl} target="_blank" rel="noopener noreferrer">官方下载与说明 <ExternalLink size={12} /></Button>
    </> : null}
  </div>
}
