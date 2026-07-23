import {
  getDefaultModel,
  getDefaultProvider,
  resolveModel,
} from '@/configs/image-providers'
import type { ProviderId } from '@/lib/image-providers/types'

const STORAGE_KEY = 'pixel-seed-image-api-prefs'
const SESSION_KEY = 'pixel-seed-image-api-key'
const SESSION_PROVIDER_KEY_PREFIX = 'pixel-seed-image-api-key:'

export interface ImageApiPrefs {
  provider: ProviderId
  model: string
  apiKey: string
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'dashscope'
    || value === 'openai'
    || value === 'openrouter'
    || value === 'cloudflare'
    || value === 'together'
    || value === 'tencent'
    || value === 'pollinations'
    || value === 'huggingface'
}

export function loadProviderApiKey(provider: ProviderId): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(`${SESSION_PROVIDER_KEY_PREFIX}${provider}`) || ''
}

export function loadImageApiPrefs(): ImageApiPrefs {
  const fallback: ImageApiPrefs = {
    provider: getDefaultProvider(),
    model: getDefaultModel(getDefaultProvider()),
    apiKey: '',
  }

  if (typeof window === 'undefined') return fallback

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      const legacyKey = sessionStorage.getItem(SESSION_KEY) || ''
      if (legacyKey) sessionStorage.setItem(`${SESSION_PROVIDER_KEY_PREFIX}${fallback.provider}`, legacyKey)
      return { ...fallback, apiKey: loadProviderApiKey(fallback.provider) || legacyKey }
    }

    const parsed = JSON.parse(raw) as Partial<ImageApiPrefs>
    const provider = isProviderId(parsed.provider) ? parsed.provider : fallback.provider
    const model = resolveModel(provider, parsed.model ?? getDefaultModel(provider))

    const legacyKey = typeof parsed.apiKey === 'string' ? parsed.apiKey : ''
    const providerKey = loadProviderApiKey(provider)
    const sessionKey = providerKey || sessionStorage.getItem(SESSION_KEY) || legacyKey
    if (legacyKey) {
      sessionStorage.setItem(`${SESSION_PROVIDER_KEY_PREFIX}${provider}`, legacyKey)
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, model }))
    }
    return {
      provider,
      model,
      apiKey: sessionKey,
    }
  } catch {
    return fallback
  }
}

export function saveImageApiPrefs(prefs: ImageApiPrefs): void {
  if (typeof window === 'undefined') return

  try {
    sessionStorage.setItem(`${SESSION_PROVIDER_KEY_PREFIX}${prefs.provider}`, prefs.apiKey)
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        provider: prefs.provider,
        model: prefs.model,
      }),
    )
  } catch (error) {
    console.warn('Failed to save image API preferences:', error)
  }
}
