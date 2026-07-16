import {
  getDefaultModel,
  getDefaultProvider,
  resolveModel,
} from '@/configs/image-providers'
import type { ProviderId } from '@/lib/image-providers/types'

const STORAGE_KEY = 'pixel-seed-image-api-prefs'

export interface ImageApiPrefs {
  provider: ProviderId
  model: string
  apiKey: string
}

function isProviderId(value: unknown): value is ProviderId {
  return value === 'dashscope' || value === 'openai' || value === 'openrouter'
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
    if (!raw) return fallback

    const parsed = JSON.parse(raw) as Partial<ImageApiPrefs>
    const provider = isProviderId(parsed.provider) ? parsed.provider : fallback.provider
    const model = resolveModel(provider, parsed.model ?? getDefaultModel(provider))

    return {
      provider,
      model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    }
  } catch {
    return fallback
  }
}

export function saveImageApiPrefs(prefs: ImageApiPrefs): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        provider: prefs.provider,
        model: prefs.model,
        apiKey: prefs.apiKey,
      }),
    )
  } catch (error) {
    console.warn('Failed to save image API preferences:', error)
  }
}
