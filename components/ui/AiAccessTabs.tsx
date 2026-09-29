'use client'

import type { AiAccessMode } from '@/lib/custom-connection'

export default function AiAccessTabs({ value, onChange, kind, disabled = false }: { value: AiAccessMode; onChange: (value: AiAccessMode) => void; kind: 'agent' | 'image'; disabled?: boolean }) {
  return <div className="ai-access-tabs" role="tablist" aria-label="AI 接入方式">
    <button type="button" role="tab" aria-selected={value === 'ready'} disabled={disabled} className={value === 'ready' ? 'active' : ''} onClick={() => onChange('ready')}>
      <strong>使用现成方案</strong>
    </button>
    <button type="button" role="tab" aria-selected={value === 'own'} disabled={disabled} className={value === 'own' ? 'active' : ''} onClick={() => onChange('own')}>
      <strong>连接我的 AI 服务</strong>
    </button>
    <p className="ai-access-explanation">{value === 'ready'
      ? kind === 'agent' ? '无需申请平台 Key：安装本机文字工具，或在浏览器下载模型。' : '无需申请平台 Key：使用内置素材、上传图片或本机生图。'
      : '使用自己的平台 Key，或填写接口地址和模型 ID；调用可能收费。'}</p>
  </div>
}
