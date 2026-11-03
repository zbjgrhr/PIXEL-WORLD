'use client'

import { useState } from 'react'
import { Button, Input, Select } from 'antd'
import type { DefaultOptionType } from 'antd/es/select'
import { getAgentProvider } from '@/lib/agents/config'
import type { AgentProviderId } from '@/types'
import type { TextCatalogModel } from '@/lib/text-model-catalog'

export default function CloudTextModelPicker({ provider, model, onChange, disabled }: { provider: AgentProviderId; model: string; onChange: (model: string) => void; disabled?: boolean }) {
  const [models, setModels] = useState<TextCatalogModel[]>([])
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const readCatalog = async () => {
    if (loading) return
    setLoading(true)
    setNotice('')
    try {
      const response = await fetch('/api/text-model-catalog', { signal: AbortSignal.timeout(20_000) })
      const result = await response.json()
      if (!response.ok || !Array.isArray(result.models) || !result.models.length) throw new Error(result.error || '模型目录暂不可用。')
      setModels(result.models)
      setNotice(`已读取 ${result.models.length} 个文字模型；当前选择保持不变。`)
    } catch {
      setNotice('目录读取失败，当前模型已保留。仍可手动填写模型 ID。')
    } finally { setLoading(false) }
  }
  const useCatalog = provider === 'openrouter' && models.length > 0
  const families = [...new Set(models.map(item => item.family))]
  const options: DefaultOptionType[] = useCatalog ? families.map(family => ({ label: family, options: models.filter(item => item.family === family).map(item => ({ value: item.id, label: `${item.name} · ${item.id}` })) }))
    : getAgentProvider(provider).models.map(item => ({ value: item.id, label: `${item.label} · ${item.id}` }))
  const chosen = useCatalog ? models.find(item => item.id === model) : undefined
  return <div className="cloud-text-model-picker">
    {provider === 'openrouter' && <div className="connection-platform-explainer"><strong>OpenRouter 是聚合平台，不是一个模型</strong><p>一个 OpenRouter Key 可调用平台提供的不同厂商模型。请在下方选择具体模型，或填写完整 ID，例如 qwen/…、deepseek/…。</p><Button size="small" disabled={disabled} loading={loading} onClick={() => { void readCatalog() }}>读取 OpenRouter 模型目录</Button><small>仅获取公开目录，不调用模型、不产生生成费用。</small></div>}
    <label className="connection-field-label">{provider === 'openrouter' ? 'OpenRouter 的具体文字模型' : '具体文字模型'}<Select aria-label="具体文字模型" showSearch value={model || undefined} disabled={disabled} onChange={onChange} options={options} filterOption={(input, option) => `${option?.label || ''} ${option?.value || ''}`.toLowerCase().includes(input.toLowerCase())} placeholder="搜索模型名称、厂商或 ID" style={{ width: '100%' }} /></label>
    {provider === 'openrouter' && !useCatalog && <small>当前显示快捷候选；读取目录可按厂商搜索更多模型。</small>}
    <label className="connection-field-label">模型 ID（可手动填写）<Input aria-label="文字模型 ID" value={model} disabled={disabled} onChange={event => onChange(event.target.value.trim())} placeholder={provider === 'openrouter' ? '厂商/模型名称，按 OpenRouter 目录填写' : '按服务商文档填写准确模型 ID'} /></label>
    {chosen && <small>目录参考价（USD / 百万 token）：输入 {chosen.inputPerMillion ?? '未提供'} / 输出 {chosen.outputPerMillion ?? '未提供'}；图片、工具及其他费用以平台为准。</small>}
    {notice && <p role="status" className="connection-catalog-notice">{notice}</p>}
    <p className="connection-availability-note">目录可见不代表账号可调用。模型权限、地区限制、余额和价格以所选平台为准；选择模型不会自动测试或生成。</p>
  </div>
}
