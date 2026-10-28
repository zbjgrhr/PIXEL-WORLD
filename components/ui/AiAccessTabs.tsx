'use client'

import type { AiAccessMode } from '@/lib/custom-connection'

export default function AiAccessTabs({ value, onChange, kind, disabled = false }: { value: AiAccessMode; onChange: (value: AiAccessMode) => void; kind: 'agent' | 'image'; disabled?: boolean }) {
  return <div className="ai-access-tabs" role="tablist" aria-label="AI 接入方式">
    <button type="button" role="tab" aria-selected={value === 'ready'} disabled={disabled} className={value === 'ready' ? 'active' : ''} onClick={() => onChange('ready')}>
      <strong>{kind === 'agent' ? '内置与本机' : '内置、上传与本机'}</strong>
    </button>
    <button type="button" role="tab" aria-selected={value === 'own'} disabled={disabled} className={value === 'own' ? 'active' : ''} onClick={() => onChange('own')}>
      <strong>{kind === 'agent' ? '我的文字 API' : '我的图片 API'}</strong>
    </button>
    <p className="ai-access-explanation">{value === 'ready'
      ? kind === 'agent' ? '内置规则无需配置；本机和浏览器 AI 需先下载模型。' : '无需申请平台 Key：使用内置素材、上传图片或本机生图。'
      : '使用自己的平台 Key，或填写接口地址和模型 ID；调用可能收费。'}</p>
  </div>
}
