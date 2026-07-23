import {
  GenerateImageParams,
  UpstreamApiError,
} from '@/lib/image-providers/types'

interface OpenAICompatibleOptions {
  baseUrl: string
  providerLabel: string
  extraHeaders?: Record<string, string>
}

const GPT_IMAGE_SIZES = new Set(['1024x1024', '1024x1536', '1536x1024'])

function isGptImageModel(model: string): boolean {
  return /gpt-image/i.test(model)
}

function buildPromptWithNegative(prompt: string, negativePrompt?: string): string {
  if (!negativePrompt?.trim()) return prompt
  return `${prompt}. Avoid: ${negativePrompt}`
}

function normalizeSize(model: string, size: string): string {
  const normalized = size.replace('*', 'x')
  if (!isGptImageModel(model)) return normalized

  if (GPT_IMAGE_SIZES.has(normalized)) return normalized
  if (normalized === '1792x1024') return '1536x1024'
  return '1024x1024'
}

function buildRequestBody(params: GenerateImageParams, prompt: string, size: string) {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt,
    n: 1,
    size,
  }

  if (isGptImageModel(params.model)) {
    body.quality = 'medium'
  }

  return body
}

function parseImageResponse(result: {
  data?: Array<{ url?: string; b64_json?: string }>
}): string {
  const first = result.data?.[0]
  if (first?.url) return first.url
  if (first?.b64_json) {
    return `data:image/png;base64,${first.b64_json}`
  }
  throw new Error('Invalid image API response format')
}

export async function callOpenAICompatibleImagesAPI(
  params: GenerateImageParams,
  options: OpenAICompatibleOptions,
): Promise<string> {
  const prompt = buildPromptWithNegative(params.prompt, params.negativePrompt)
  const size = normalizeSize(params.model, params.size ?? '1024x1024')

  const response = await fetch(`${options.baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      ...options.extraHeaders,
    },
    body: JSON.stringify(buildRequestBody(params, prompt, size)),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new UpstreamApiError(
      options.providerLabel as 'openai' | 'openrouter',
      params.model,
      response.status,
      errorText,
    )
  }

  const result = await response.json()
  return parseImageResponse(result)
}
