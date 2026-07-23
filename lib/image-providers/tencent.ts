import { promptWithNegative } from '@/lib/image-providers/dimensions'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'
import { UpstreamApiError } from '@/lib/image-providers/types'

const TOKENHUB_BASE = process.env.TENCENT_TOKENHUB_BASE_URL?.trim()
  || 'https://tokenhub.tencentmaas.com'

interface TencentImageResponse {
  id?: string
  status?: string
  data?: Array<{ url?: string }>
  error?: unknown
  message?: string
}

function headers(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }
}

async function parseJson(response: Response, model: string): Promise<TencentImageResponse> {
  const text = await response.text()
  if (!response.ok) throw new UpstreamApiError('tencent', model, response.status, text)
  try {
    return JSON.parse(text) as TencentImageResponse
  } catch {
    throw new UpstreamApiError('tencent', model, 502, 'Invalid JSON response')
  }
}

async function generateLite(params: GenerateImageParams, prompt: string): Promise<string> {
  const response = await fetch(`${TOKENHUB_BASE}/v1/api/image/lite`, {
    method: 'POST',
    headers: headers(params.apiKey),
    body: JSON.stringify({ model: 'hy-image-lite', prompt, rsp_img_type: 'url' }),
  })
  const payload = await parseJson(response, params.model)
  const url = payload.data?.[0]?.url
  if (!url) throw new UpstreamApiError('tencent', params.model, 502, JSON.stringify(payload))
  return url
}

async function generateV3(params: GenerateImageParams, prompt: string): Promise<string> {
  const publicReferences = (params.referenceImages || []).filter((url) => /^https:\/\//i.test(url)).slice(0, 4)
  const submitResponse = await fetch(`${TOKENHUB_BASE}/v1/api/image/submit`, {
    method: 'POST',
    headers: headers(params.apiKey),
    body: JSON.stringify({
      model: 'hy-image-v3.0',
      prompt,
      ...(publicReferences.length ? { images: publicReferences } : {}),
    }),
  })
  const submitted = await parseJson(submitResponse, params.model)
  if (!submitted.id) throw new UpstreamApiError('tencent', params.model, 502, JSON.stringify(submitted))

  for (let attempt = 0; attempt < 45; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500))
    const queryResponse = await fetch(`${TOKENHUB_BASE}/v1/api/image/query`, {
      method: 'POST',
      headers: headers(params.apiKey),
      body: JSON.stringify({ model: 'hy-image-v3.0', id: submitted.id }),
    })
    const payload = await parseJson(queryResponse, params.model)
    if (payload.status === 'completed') {
      const url = payload.data?.[0]?.url
      if (url) return url
      throw new UpstreamApiError('tencent', params.model, 502, JSON.stringify(payload))
    }
    if (payload.status === 'failed' || payload.status === 'cancelled') {
      throw new UpstreamApiError('tencent', params.model, 400, JSON.stringify(payload.error || payload))
    }
  }
  throw new UpstreamApiError('tencent', params.model, 408, 'Image job timed out before completion')
}

export const tencentProvider: ImageProvider = {
  id: 'tencent',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const prompt = promptWithNegative(params.prompt, params.negativePrompt)
    return params.model === 'hy-image-lite'
      ? generateLite(params, prompt)
      : generateV3(params, prompt)
  },
}
