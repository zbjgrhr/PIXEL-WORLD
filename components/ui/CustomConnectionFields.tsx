'use client'

import { Input, Typography } from 'antd'
import type { CustomConnection } from '@/lib/custom-connection'

export default function CustomConnectionFields({ value, onChange, kind, disabled = false }: { value: CustomConnection; onChange: (value: CustomConnection) => void; kind: 'agent' | 'image'; disabled?: boolean }) {
  const update = (field: keyof CustomConnection, text: string) => onChange({ ...value, [field]: text })
  return <div className="custom-connection-fields">
    <label>显示名称（可留空）<Input disabled={disabled} value={value.displayName} onChange={(event) => update('displayName', event.target.value)} placeholder="例如：我的模型服务" /></label>
    <label>接口地址（API 根地址）<Input disabled={disabled} value={value.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} placeholder="https://example.com/v1" /></label>
    <label>模型 ID<Input disabled={disabled} value={value.model} onChange={(event) => update('model', event.target.value)} placeholder="按服务商文档填写准确名称" /></label>
    <label>API Key<Input.Password value={value.apiKey} onChange={(event) => update('apiKey', event.target.value)} placeholder="该服务商提供的调用密码" autoComplete="new-password" /></label>
    <Typography.Text type="secondary">{kind === 'agent' ? '文字服务需兼容 OpenAI 风格的 /chat/completions，并能返回 Agent 使用的结构化内容。' : '图片服务需兼容 OpenAI 风格的 /images/generations，并返回图片数据或可读取的图片链接。'}仅填平台名称和 Key 无法调用；其他协议不保证兼容。</Typography.Text>
  </div>
}
