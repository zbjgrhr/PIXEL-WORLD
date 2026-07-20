import {
  OPENROUTER_FALLBACK_IMAGE_MODEL,
  OPENROUTER_PRIMARY_IMAGE_MODEL,
} from '@/configs/image-providers'
import {
  type GenerateImageParams,
  type ImageProvider,
  UpstreamApiError,
} from '@/lib/image-providers/types'

const OPENROUTER_IMAGE_API_URL = 'https://openrouter.ai/api/v1/images'

interface OpenRouterImageResponse {
  data?: Array<{
    url?: string
    b64_json?: string
    media_type?: string
  }>
}

interface OpenRouterEndpointsResponse {
  endpoints?: Array<{ supported_parameters?: Record<string, unknown> }>
}

const referenceCapabilityCache = new Map<string, boolean>()

function getOpenRouterHeaders(): Record<string, string> {
  const referer =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://prompt-play-pixel-game.vercel.app'

  return {
    'HTTP-Referer': referer,
    'X-Title': 'Pixel World',
  }
}

function getAspectRatio(assetType: GenerateImageParams['assetType'], layout?: GenerateImageParams['layout'], frameCount = 1): string {
  if (layout === 'sprite-sheet') return '1:1'
  if (layout === 'animation-strip') return frameCount >= 3 ? '16:9' : frameCount === 2 ? '3:2' : '1:1'
  return assetType === 'background' ? '16:9' : '1:1'
}

function buildPrompt(prompt: string, negativePrompt?: string): string {
  if (!negativePrompt?.trim()) return prompt
  return `${prompt}\n\nStrict exclusions: ${negativePrompt}`
}

function buildImageRequestBody(
  params: GenerateImageParams,
  model: string,
  supportsReferences: boolean,
): Record<string, unknown> {
  const commonBody = {
    model,
    prompt: buildPrompt(params.prompt, params.negativePrompt),
    n: 1,
    provider: {
      sort: 'price',
      allow_fallbacks: true,
    },
    ...(supportsReferences && params.referenceImages?.length ? {
      input_references: params.referenceImages.map((url) => ({
        type: 'image_url',
        image_url: { url },
      })),
    } : {}),
  }

  if (model === OPENROUTER_PRIMARY_IMAGE_MODEL) {
    return {
      ...commonBody,
      resolution: '2K',
      aspect_ratio: getAspectRatio(params.assetType, params.layout, params.frameCount),
    }
  }

  return commonBody
}

async function modelSupportsReferences(apiKey: string, model: string): Promise<boolean> {
  const cached = referenceCapabilityCache.get(model)
  if (cached !== undefined) return cached
  try {
    const response = await fetch(`${OPENROUTER_IMAGE_API_URL}/models/${model}/endpoints`, {
      headers: { Authorization: `Bearer ${apiKey}`, ...getOpenRouterHeaders() },
      cache: 'no-store',
    })
    if (!response.ok) return false
    const result = await response.json() as OpenRouterEndpointsResponse
    const supported = Boolean(result.endpoints?.some((endpoint) => endpoint.supported_parameters?.input_references))
    referenceCapabilityCache.set(model, supported)
    return supported
  } catch {
    return false
  }
}

function parseImageResponse(result: OpenRouterImageResponse, model: string): string {
  const first = result.data?.[0]
  if (first?.url) return first.url
  if (first?.b64_json) {
    const mediaType = first.media_type?.trim() || 'image/png'
    return `data:${mediaType};base64,${first.b64_json}`
  }
  throw new UpstreamApiError('openrouter', model, 502, 'Invalid Image API response format')
}

async function callOpenRouterImageAPI(
  params: GenerateImageParams,
  model: string,
): Promise<string> {
  const supportsReferences = Boolean(params.referenceImages?.length)
    && await modelSupportsReferences(params.apiKey, model)
  const response = await fetch(OPENROUTER_IMAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      ...getOpenRouterHeaders(),
    },
    body: JSON.stringify(buildImageRequestBody(params, model, supportsReferences)),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new UpstreamApiError('openrouter', model, response.status, errorText)
  }

  const result = await response.json() as OpenRouterImageResponse
  return parseImageResponse(result, model)
}

function canTryFallback(error: unknown): boolean {
  if (!(error instanceof UpstreamApiError)) return false
  const detail = error.message.toLowerCase()
  return (
    error.status === 404 ||
    error.status === 408 ||
    error.status === 409 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500 ||
    (error.status === 400 && (
      detail.includes('protected content')
      || detail.includes('request moderated')
      || detail.includes('content policy')
      || detail.includes('content_policy')
    ))
  )
}

export const openrouterProvider: ImageProvider = {
  id: 'openrouter',

  async generateImage(params: GenerateImageParams): Promise<string> {
    try {
      return await callOpenRouterImageAPI(params, params.model)
    } catch (error) {
      const shouldUseFluxFallback =
        params.model === OPENROUTER_PRIMARY_IMAGE_MODEL && canTryFallback(error)

      if (!shouldUseFluxFallback) throw error

      console.warn(
        `OpenRouter ${OPENROUTER_PRIMARY_IMAGE_MODEL} failed; retrying with ${OPENROUTER_FALLBACK_IMAGE_MODEL}.`,
      )
      return callOpenRouterImageAPI(params, OPENROUTER_FALLBACK_IMAGE_MODEL)
    }
  },
}
