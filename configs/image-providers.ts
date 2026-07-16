import type { EndpointKind, ProviderId } from '@/lib/image-providers/types'

export interface ModelConfig {
  id: string
  label: string
  supportsNegativePrompt: boolean
  endpointKind: EndpointKind
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  labelZh: string
  envKey: string
  keyHint: string
  keyHintZh: string
  models: ModelConfig[]
}

export const IMAGE_PROVIDERS: ProviderConfig[] = [
  {
    id: 'dashscope',
    label: 'Alibaba DashScope',
    labelZh: '阿里云 DashScope',
    envKey: 'DASHSCOPE_API_KEY',
    keyHint: 'DashScope API Key from dashscope.aliyun.com',
    keyHintZh: '百炼 DashScope API Key · dashscope.aliyun.com',
    models: [
      {
        id: 'qwen-image',
        label: 'Qwen-Image',
        supportsNegativePrompt: true,
        endpointKind: 'dashscope',
      },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    labelZh: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    keyHint: 'OpenAI API Key (sk-proj-... or sk-...)',
    keyHintZh: 'OpenAI API Key · platform.openai.com',
    models: [
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
      {
        id: 'gpt-image-1.5',
        label: 'GPT Image 1.5',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
      {
        id: 'gpt-image-1-mini',
        label: 'GPT Image 1 Mini',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (Aggregated)',
    labelZh: 'OpenRouter（聚合 API）',
    envKey: 'OPENROUTER_API_KEY',
    keyHint: 'OpenRouter API Key — one key, many models',
    keyHintZh: 'OpenRouter Key · 一个 Key 可选多模型 · openrouter.ai',
    models: [
      {
        id: 'openai/gpt-image-2',
        label: 'OpenAI GPT Image 2',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
      {
        id: 'openai/gpt-image-1.5',
        label: 'OpenAI GPT Image 1.5',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
      {
        id: 'black-forest-labs/flux-schnell',
        label: 'Flux Schnell',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
      {
        id: 'x-ai/grok-2-image',
        label: 'xAI Grok 2 Image',
        supportsNegativePrompt: false,
        endpointKind: 'images',
      },
    ],
  },
]

export function getProviderConfig(providerId: ProviderId): ProviderConfig | undefined {
  return IMAGE_PROVIDERS.find((p) => p.id === providerId)
}

export function getModelConfig(providerId: ProviderId, modelId: string): ModelConfig | undefined {
  return getProviderConfig(providerId)?.models.find((m) => m.id === modelId)
}

export function getDefaultProvider(): ProviderId {
  return 'openai'
}

export function getDefaultModel(providerId: ProviderId): string {
  return getProviderConfig(providerId)?.models[0]?.id ?? 'qwen-image'
}

export function isValidProviderModel(providerId: ProviderId, modelId: string): boolean {
  return Boolean(getModelConfig(providerId, modelId))
}

const DEPRECATED_MODEL_ALIASES: Record<string, string> = {
  'dall-e-3': 'gpt-image-2',
  'dall-e-2': 'gpt-image-2',
  'gpt-image-1': 'gpt-image-2',
  'openai/gpt-image-1': 'openai/gpt-image-2',
}

/** Maps retired or unknown model ids to a supported default. */
export function resolveModel(providerId: ProviderId, modelId: string): string {
  if (isValidProviderModel(providerId, modelId)) return modelId

  const alias = DEPRECATED_MODEL_ALIASES[modelId]
  if (alias && isValidProviderModel(providerId, alias)) return alias

  return getDefaultModel(providerId)
}
