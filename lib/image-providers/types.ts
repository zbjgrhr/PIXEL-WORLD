export type ProviderId = 'dashscope' | 'openai' | 'openrouter'

export type AssetType = import('@/types').AssetType

export type EndpointKind = 'dashscope' | 'images' | 'openrouter-images'

export interface GenerateImageParams {
  prompt: string
  negativePrompt?: string
  referenceImages?: string[]
  assetType: AssetType
  apiKey: string
  model: string
  size?: string
  layout?: 'single' | 'sprite-sheet' | 'animation-strip'
  frameCount?: number
}

export interface ImageProvider {
  id: ProviderId
  generateImage(params: GenerateImageParams): Promise<string>
}

export class ProviderApiKeyError extends Error {
  provider: ProviderId

  constructor(provider: ProviderId) {
    super(
      `API key is required for ${provider}. Provide apiKey in request body or set the provider env variable.`,
    )
    this.name = 'ProviderApiKeyError'
    this.provider = provider
  }
}

export class ProviderValidationError extends Error {
  provider?: ProviderId

  constructor(message: string, provider?: ProviderId) {
    super(message)
    this.name = 'ProviderValidationError'
    this.provider = provider
  }
}

export class UpstreamApiError extends Error {
  provider: ProviderId
  model: string
  status: number

  constructor(provider: ProviderId, model: string, status: number, detail: string) {
    super(`${provider} API error (${model}): ${status} - ${detail}`)
    this.name = 'UpstreamApiError'
    this.provider = provider
    this.model = model
    this.status = status
  }
}
