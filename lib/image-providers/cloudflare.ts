import { getImageDimensions, bytesToDataUrl, promptWithNegative } from '@/lib/image-providers/dimensions'
import {
  type GenerateImageParams,
  type ImageProvider,
  ProviderValidationError,
  UpstreamApiError,
} from '@/lib/image-providers/types'
import sharp from 'sharp'

interface CloudflareResponse {
  success?: boolean
  errors?: unknown[]
  result?: { image?: string }
  image?: string
}

function parseCredentials(value: string): { accountId: string; token: string } {
  const divider = value.indexOf('|')
  const accountId = divider >= 0 ? value.slice(0, divider).trim() : ''
  const token = divider >= 0 ? value.slice(divider + 1).trim() : ''
  if (!accountId || !token) {
    throw new ProviderValidationError(
      'Cloudflare 凭据格式应为 Account ID|API Token，中间使用英文竖线 |。',
      'cloudflare',
    )
  }
  return { accountId, token }
}

async function referenceToBlob(reference: string): Promise<Blob | null> {
  const dataMatch = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i)
  if (dataMatch) {
    const bytes = await sharp(Buffer.from(dataMatch[2], 'base64')).resize({ width: 511, height: 511, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
    return new Blob([new Uint8Array(bytes)], { type: 'image/png' })
  }
  if (!/^https:\/\//i.test(reference)) return null
  const response = await fetch(reference, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
  if (!response.ok) return null
  const contentType = response.headers.get('content-type') || 'image/png'
  if (!contentType.startsWith('image/')) return null
  const bytes = await sharp(Buffer.from(await response.arrayBuffer())).resize({ width: 511, height: 511, fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  return new Blob([new Uint8Array(bytes)], { type: 'image/png' })
}

async function parseResponse(response: Response, model: string): Promise<string> {
  if (!response.ok) {
    throw new UpstreamApiError('cloudflare', model, response.status, await response.text())
  }
  const contentType = response.headers.get('content-type') || ''
  if (contentType.startsWith('image/')) {
    return bytesToDataUrl(await response.arrayBuffer(), contentType)
  }
  const payload = await response.json() as CloudflareResponse
  const image = payload.result?.image || payload.image
  if (!image) {
    throw new UpstreamApiError('cloudflare', model, 502, JSON.stringify(payload.errors || payload))
  }
  return image.startsWith('data:image/') ? image : `data:image/jpeg;base64,${image}`
}

export const cloudflareProvider: ImageProvider = {
  id: 'cloudflare',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const { accountId, token } = parseCredentials(params.apiKey)
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${params.model}`
    const prompt = promptWithNegative(params.prompt, params.negativePrompt)
    const headers = { Authorization: `Bearer ${token}` }

    if (params.model.endsWith('/flux-1-schnell')) {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.slice(0, 2048), steps: 4 }),
      })
      return parseResponse(response, params.model)
    }

    const { width, height } = getImageDimensions(params)
    const form = new FormData()
    form.append('prompt', prompt)
    form.append('width', String(width))
    form.append('height', String(height))
    form.append('steps', params.model.endsWith('/flux-2-dev') ? '20' : '4')
    for (const [index, reference] of (params.referenceImages || []).slice(0, 4).entries()) {
      const blob = await referenceToBlob(reference)
      if (blob) form.append(`input_image_${index}`, blob, `reference-${index + 1}.png`)
    }
    const response = await fetch(endpoint, { method: 'POST', headers, body: form, signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) })
    return parseResponse(response, params.model)
  },
}
