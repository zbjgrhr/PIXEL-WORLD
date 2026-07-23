import {
  getDefaultModel,
  getDefaultProvider,
  getProviderConfig,
  isValidProviderModel,
  resolveModel,
} from '@/configs/image-providers'
import { dashscopeProvider } from '@/lib/image-providers/dashscope'
import { cloudflareProvider } from '@/lib/image-providers/cloudflare'
import { huggingfaceProvider } from '@/lib/image-providers/huggingface'
import { openaiProvider } from '@/lib/image-providers/openai'
import { openrouterProvider } from '@/lib/image-providers/openrouter'
import { pollinationsProvider } from '@/lib/image-providers/pollinations'
import { tencentProvider } from '@/lib/image-providers/tencent'
import { togetherProvider } from '@/lib/image-providers/together'
import {
  ProviderApiKeyError,
  ProviderValidationError,
  type ImageProvider,
  type ProviderId,
} from '@/lib/image-providers/types'
import { apiKeyHasUnsupportedCharacters, normalizeApiKey } from '@/lib/api-key'

const providers: Record<ProviderId, ImageProvider> = {
  dashscope: dashscopeProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
  cloudflare: cloudflareProvider,
  together: togetherProvider,
  tencent: tencentProvider,
  pollinations: pollinationsProvider,
  huggingface: huggingfaceProvider,
}

export function getImageProvider(providerId: ProviderId): ImageProvider {
  const provider = providers[providerId]
  if (!provider) {
    throw new ProviderValidationError(`Unknown provider: ${providerId}`)
  }
  return provider
}

export function resolveApiKey(providerId: ProviderId, requestKey?: string): string {
  const config = getProviderConfig(providerId)
  if (!config) {
    throw new ProviderValidationError(`Unknown provider: ${providerId}`)
  }

  const rawKey = requestKey?.trim() || process.env[config.envKey]?.trim()
  const key = normalizeApiKey(rawKey)
  if (!key) {
    throw new ProviderApiKeyError(providerId)
  }
  if (apiKeyHasUnsupportedCharacters(key)) {
    throw new ProviderValidationError(
      'API Key contains unsupported characters. Clear the field and paste only the key from the provider dashboard.',
      providerId,
    )
  }
  return key
}

export function normalizeProviderRequest(
  provider?: string,
  model?: string,
): { provider: ProviderId; model: string } {
  const resolvedProvider = (provider as ProviderId) || getDefaultProvider()
  const config = getProviderConfig(resolvedProvider)

  if (!config) {
    throw new ProviderValidationError(`Invalid provider: ${provider}`, resolvedProvider)
  }

  const resolvedModel = resolveModel(resolvedProvider, model?.trim() || getDefaultModel(resolvedProvider))

  if (!isValidProviderModel(resolvedProvider, resolvedModel)) {
    throw new ProviderValidationError(
      `Invalid model "${resolvedModel}" for provider "${resolvedProvider}"`,
      resolvedProvider,
    )
  }

  return { provider: resolvedProvider, model: resolvedModel }
}

export { ProviderApiKeyError, ProviderValidationError, UpstreamApiError } from '@/lib/image-providers/types'
