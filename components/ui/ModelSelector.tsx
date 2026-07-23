'use client'

import { Typography, Select, Input, message } from 'antd'
import Image from 'next/image'
import { useEffect } from 'react'
import {
  getProviderConfig,
  IMAGE_PROVIDERS,
  resolveModel,
} from '@/configs/image-providers'
import type { ProviderId } from '@/lib/image-providers/types'
import { ModelSelectorProps } from '@/types'
import { apiKeyHasUnsupportedCharacters, normalizeApiKey } from '@/lib/api-key'

const { Text } = Typography
const { Option } = Select

function looksLikeOpenAiKey(value: string): boolean {
  return value.startsWith('sk-') || value.startsWith('sk-proj-')
}

function looksLikeInvalidKey(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return apiKeyHasUnsupportedCharacters(trimmed)
    || trimmed.startsWith('[')
    || trimmed.includes('[Intervention]')
    || trimmed.includes('Generation error')
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
  }

  const handleApiKeyChange = (value: string) => {
    const normalizedValue = normalizeApiKey(value)
    onApiKeyChange(normalizedValue)

    if (looksLikeInvalidKey(normalizedValue)) {
      message.error('API Key 无效：请勿粘贴浏览器控制台内容，只粘贴平台提供的 Key。')
      return
    }

    if (looksLikeOpenAiKey(normalizedValue) && selectedProvider === 'dashscope') {
      message.warning('这像是 OpenAI Key，请将 Provider 切换为 OpenAI。')
    }

    if (selectedProvider === 'openai' && normalizedValue && !looksLikeOpenAiKey(normalizedValue)) {
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
        <Text style={{ color: '#1677ff', fontSize: '12px', display: 'block', marginTop: '4px' }}>
          整套项目锁定此模型：所有图片资源统一生成，不按素材类别分流
        </Text>
        {selectedProvider === 'openai' && (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            推荐 GPT Image 1 Mini（更省额度）· 每次 Create Theme 至少生成 4 张图
          </Text>
        )}
        {providerConfig?.noteZh && selectedProvider !== 'openai' && (
          <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
            {providerConfig.noteZh}
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
            {providerConfig?.setupUrl && (
              <> · <a href={providerConfig.setupUrl} target="_blank" rel="noreferrer">获取 Key</a></>
            )}
          </Text>
        )}
      </div>
    </>
  )
}

export default ModelSelector
