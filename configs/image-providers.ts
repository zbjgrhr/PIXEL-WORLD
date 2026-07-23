import type { EndpointKind, ProviderId } from '@/lib/image-providers/types'

export interface ModelConfig {
  id: string
  label: string
  supportsNegativePrompt: boolean
  endpointKind: EndpointKind
  supportsReferenceImages?: boolean
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  labelZh: string
  envKey: string
  keyHint: string
  keyHintZh: string
  setupUrl: string
  noteZh?: string
  models: ModelConfig[]
}

export const OPENROUTER_PRIMARY_IMAGE_MODEL = 'bytedance-seed/seedream-4.5'
export const OPENROUTER_FLUX_IMAGE_MODEL = 'black-forest-labs/flux.2-pro'

export const IMAGE_PROVIDERS: ProviderConfig[] = [
  {
    id: 'dashscope',
    label: 'Alibaba DashScope',
    labelZh: '阿里云 DashScope',
    envKey: 'DASHSCOPE_API_KEY',
    keyHint: 'DashScope API Key from dashscope.aliyun.com',
    keyHintZh: '百炼 DashScope API Key · dashscope.aliyun.com',
    setupUrl: 'https://bailian.console.aliyun.com/',
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
    setupUrl: 'https://platform.openai.com/api-keys',
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
    setupUrl: 'https://openrouter.ai/settings/keys',
    noteZh: '整套素材只使用当前所选模型；不会自动切换到其他模型。',
    models: [
      {
        id: OPENROUTER_PRIMARY_IMAGE_MODEL,
        label: 'Seedream 4.5（默认）',
        supportsNegativePrompt: false,
        endpointKind: 'openrouter-images',
        supportsReferenceImages: true,
      },
      {
        id: OPENROUTER_FLUX_IMAGE_MODEL,
        label: 'FLUX.2 Pro（手动选择）',
        supportsNegativePrompt: false,
        endpointKind: 'openrouter-images',
        supportsReferenceImages: true,
      },
    ],
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    labelZh: 'Cloudflare Workers AI',
    envKey: 'CLOUDFLARE_WORKERS_AI_CREDENTIALS',
    keyHint: 'ACCOUNT_ID|API_TOKEN',
    keyHintZh: '按“Account ID|API Token”粘贴，中间使用英文竖线 |',
    setupUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    noteZh: '需要 Account ID 和 Workers AI API Token；FLUX.2 支持参考图，适合保持动作角色一致。',
    models: [
      {
        id: '@cf/black-forest-labs/flux-2-klein-4b',
        label: 'FLUX.2 Klein 4B（低价快速）',
        supportsNegativePrompt: false,
        endpointKind: 'cloudflare-workers-ai',
        supportsReferenceImages: true,
      },
      {
        id: '@cf/black-forest-labs/flux-2-klein-9b',
        label: 'FLUX.2 Klein 9B（更高质量）',
        supportsNegativePrompt: false,
        endpointKind: 'cloudflare-workers-ai',
        supportsReferenceImages: true,
      },
      {
        id: '@cf/black-forest-labs/flux-2-dev',
        label: 'FLUX.2 Dev（高质量）',
        supportsNegativePrompt: false,
        endpointKind: 'cloudflare-workers-ai',
        supportsReferenceImages: true,
      },
      {
        id: '@cf/black-forest-labs/flux-1-schnell',
        label: 'FLUX.1 Schnell（最低成本）',
        supportsNegativePrompt: false,
        endpointKind: 'cloudflare-workers-ai',
      },
    ],
  },
  {
    id: 'together',
    label: 'Together AI',
    labelZh: 'Together AI',
    envKey: 'TOGETHER_API_KEY',
    keyHint: 'Together AI API Key',
    keyHintZh: 'Together AI Key · api.together.ai',
    setupUrl: 'https://api.together.ai/settings/api-keys',
    noteZh: 'FLUX.1 Schnell 价格低；FLUX.2 可使用参考图保持角色与武器一致。',
    models: [
      {
        id: 'black-forest-labs/FLUX.1-schnell-Free',
        label: 'FLUX.1 Schnell Free（如账户可用）',
        supportsNegativePrompt: true,
        endpointKind: 'together-images',
      },
      {
        id: 'black-forest-labs/FLUX.1-schnell',
        label: 'FLUX.1 Schnell（低价）',
        supportsNegativePrompt: true,
        endpointKind: 'together-images',
      },
      {
        id: 'black-forest-labs/FLUX.2-pro',
        label: 'FLUX.2 Pro（高质量＋参考图）',
        supportsNegativePrompt: false,
        endpointKind: 'together-images',
        supportsReferenceImages: true,
      },
      {
        id: 'black-forest-labs/FLUX.2-dev',
        label: 'FLUX.2 Dev（平衡）',
        supportsNegativePrompt: false,
        endpointKind: 'together-images',
        supportsReferenceImages: true,
      },
    ],
  },
  {
    id: 'tencent',
    label: 'Tencent TokenHub',
    labelZh: '腾讯云 TokenHub',
    envKey: 'TENCENT_TOKENHUB_API_KEY',
    keyHint: 'Tencent TokenHub API Key',
    keyHintZh: '腾讯云 TokenHub Key · 新用户通常有混元生图体验额度',
    setupUrl: 'https://console.cloud.tencent.com/tokenhub',
    noteZh: 'HY-Image-V3.0 适合复杂中文提示词；极速版响应更快。',
    models: [
      {
        id: 'hy-image-v3.0',
        label: 'HY-Image-V3.0（高质量）',
        supportsNegativePrompt: false,
        endpointKind: 'tencent-tokenhub',
        supportsReferenceImages: true,
      },
      {
        id: 'hy-image-lite',
        label: 'HY-Image-Lite（极速）',
        supportsNegativePrompt: false,
        endpointKind: 'tencent-tokenhub',
      },
    ],
  },
  {
    id: 'pollinations',
    label: 'Pollinations',
    labelZh: 'Pollinations',
    envKey: 'POLLINATIONS_API_KEY',
    keyHint: 'Pollinations API Key',
    keyHintZh: 'Pollinations Key · enter.pollinations.ai',
    setupUrl: 'https://enter.pollinations.ai/',
    noteZh: '账户可用模型会随额度变化；可先用“测试 API”确认当前模型权限。',
    models: [
      {
        id: 'zimage',
        label: 'Z-Image（低成本默认）',
        supportsNegativePrompt: false,
        endpointKind: 'pollinations-images',
        supportsReferenceImages: true,
      },
      {
        id: 'flux',
        label: 'FLUX',
        supportsNegativePrompt: false,
        endpointKind: 'pollinations-images',
        supportsReferenceImages: true,
      },
      {
        id: 'klein',
        label: 'FLUX Klein',
        supportsNegativePrompt: false,
        endpointKind: 'pollinations-images',
        supportsReferenceImages: true,
      },
      {
        id: 'seedream',
        label: 'Seedream',
        supportsNegativePrompt: false,
        endpointKind: 'pollinations-images',
        supportsReferenceImages: true,
      },
    ],
  },
  {
    id: 'huggingface',
    label: 'Hugging Face Inference',
    labelZh: 'Hugging Face 推理服务',
    envKey: 'HF_TOKEN',
    keyHint: 'Hugging Face token (hf_...)',
    keyHintZh: 'Hugging Face Token（需勾选 Make calls to Inference Providers）',
    setupUrl: 'https://huggingface.co/settings/tokens',
    noteZh: '免费额度和模型可用性由 Hugging Face 账户决定；这些模型均可生成整套资源。',
    models: [
      {
        id: 'black-forest-labs/FLUX.1-schnell',
        label: 'FLUX.1 Schnell',
        supportsNegativePrompt: true,
        endpointKind: 'huggingface-inference',
      },
      {
        id: 'stabilityai/stable-diffusion-xl-base-1.0',
        label: 'Stable Diffusion XL',
        supportsNegativePrompt: true,
        endpointKind: 'huggingface-inference',
      },
      {
        id: 'ByteDance/Hyper-SD',
        label: 'Hyper-SD',
        supportsNegativePrompt: true,
        endpointKind: 'huggingface-inference',
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
  return 'openrouter'
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
  'openai/gpt-image-1': OPENROUTER_PRIMARY_IMAGE_MODEL,
  'openai/gpt-image-1.5': OPENROUTER_PRIMARY_IMAGE_MODEL,
  'openai/gpt-image-2': OPENROUTER_PRIMARY_IMAGE_MODEL,
  'black-forest-labs/flux-schnell': OPENROUTER_FLUX_IMAGE_MODEL,
  'x-ai/grok-2-image': OPENROUTER_PRIMARY_IMAGE_MODEL,
}

/** Maps retired or unknown model ids to a supported default. */
export function resolveModel(providerId: ProviderId, modelId: string): string {
  if (isValidProviderModel(providerId, modelId)) return modelId

  const alias = DEPRECATED_MODEL_ALIASES[modelId]
  if (alias && isValidProviderModel(providerId, alias)) return alias

  return getDefaultModel(providerId)
}
