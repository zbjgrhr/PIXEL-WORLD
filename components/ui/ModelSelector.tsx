'use client'

import { Typography, Select, Input, message } from 'antd'
import Image from 'next/image'
import { useEffect } from 'react'
import {
  getDefaultModel,
  getProviderConfig,
  IMAGE_PROVIDERS,
  resolveModel,
} from '@/configs/image-providers'
import type { ProviderId } from '@/lib/image-providers/types'
import { ModelSelectorProps } from '@/types'

const { Text } = Typography
const { Option } = Select

function looksLikeOpenAiKey(value: string): boolean {
  return value.startsWith('sk-') || value.startsWith('sk-proj-')
}

function looksLikeInvalidKey(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return trimmed.startsWith('[') || trimmed.includes('[Intervention]') || trimmed.includes('Generation error')
}

const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedProvider,
  onProviderChange,
  selectedModel,
  onModelChange,
  apiKey,
  onApiKeyChange,
}) => {
  const providerConfig = getProviderConfig(selectedProvider)
  const models = providerConfig?.models ?? []
  const activeModel = resolveModel(selectedProvider, selectedModel)

  useEffect(() => {
    if (activeModel !== selectedModel) {
      onModelChange(activeModel)
    }
  }, [activeModel, selectedModel, onModelChange])

  const handleProviderChange = (provider: ProviderId) => {
    onProviderChange(provider)
    onModelChange(getDefaultModel(provider))
  }

  const handleApiKeyChange = (value: string) => {
    onApiKeyChange(value)

    if (looksLikeInvalidKey(value)) {
      message.error('API Key 无效：请勿粘贴浏览器控制台内容，只粘贴平台提供的 Key。')
      return
    }

    if (looksLikeOpenAiKey(value) && selectedProvider === 'dashscope') {
      message.warning('这像是 OpenAI Key，请将 Provider 切换为 OpenAI。')
    }

    if (selectedProvider === 'openai' && value.trim() && !looksLikeOpenAiKey(value)) {
      message.warning('OpenAI Key 通常以 sk- 或 sk-proj- 开头，请检查是否粘贴完整。')
    }
  }

  const keyLooksWrong =
    Boolean(apiKey.trim()) &&
    (looksLikeInvalidKey(apiKey) ||
      (selectedProvider === 'openai' && !looksLikeOpenAiKey(apiKey)))

  return (
    <>
      <div>
        <Text strong style={{ display: 'block', marginBottom: '8px' }}>
          Provider / 平台
        </Text>
        <Select
          value={selectedProvider}
          onChange={handleProviderChange}
          style={{ width: '100%' }}
          placeholder="Select provider"
        >
          {IMAGE_PROVIDERS.map((provider) => (
            <Option key={provider.id} value={provider.id}>
              {provider.labelZh} · {provider.label}
            </Option>
          ))}
        </Select>
      </div>

      <div>
        <Text strong style={{ display: 'block', marginBottom: '8px' }}>
          Model / 模型
        </Text>
        <Select
          value={activeModel}
          onChange={onModelChange}
          style={{ width: '100%' }}
          placeholder="Select a model"
        >
          {models.map((model) => (
            <Option key={model.id} value={model.id}>
              {selectedProvider === 'dashscope' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Image src="/qwen.svg" alt="Qwen" width={16} height={16} />
                  {model.label}
                </div>
              ) : (
                model.label
              )}
            </Option>
          ))}
        </Select>
        {selectedProvider === 'openrouter' && (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            生图默认 Seedream 4.5，失败时回退 FLUX.2 Pro；文字优化优先使用免费路由
          </Text>
        )}
        {selectedProvider === 'openai' && (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            推荐 GPT Image 1 Mini（更省额度）· 每次 Create Theme 至少生成 4 张图
          </Text>
        )}
      </div>

      <div>
        <Text strong style={{ display: 'block', marginBottom: '8px' }}>API Key</Text>
        <Input.Password
          value={apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          placeholder={providerConfig?.keyHint ?? 'Enter your API key'}
          style={{ width: '100%' }}
          autoComplete="new-password"
          status={keyLooksWrong ? 'error' : undefined}
        />
        {keyLooksWrong ? (
          <Text type="danger" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            Key 格式异常，请清空后从当前 Provider 的控制台重新复制
          </Text>
        ) : (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            {providerConfig?.keyHintZh}
          </Text>
        )}
      </div>
    </>
  )
}

export default ModelSelector
