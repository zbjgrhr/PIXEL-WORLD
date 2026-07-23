import { getImageDimensions, promptWithNegative } from '@/lib/image-providers/dimensions'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'
import { UpstreamApiError } from '@/lib/image-providers/types'

interface PollinationsResponse {
  data?: Array<{ url?: string; b64_json?: string }>
}

export const pollinationsProvider: ImageProvider = {
  id: 'pollinations',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const { width, height } = getImageDimensions(params)
    const response = await fetch('https://gen.pollinations.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        prompt: promptWithNegative(params.prompt, params.negativePrompt),
        n: 1,
        size: `${width}x${height}`,
        quality: 'medium',
        response_format: 'b64_json',
        safe: 'privacy,secrets',
        ...(params.referenceImages?.length ? { image: params.referenceImages.slice(0, 4) } : {}),
      }),
    })
    if (!response.ok) {
      throw new UpstreamApiError('pollinations', params.model, response.status, await response.text())
    }
    const payload = await response.json() as PollinationsResponse
    const image = payload.data?.[0]
    if (image?.url) return image.url
    if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`
    throw new UpstreamApiError('pollinations', params.model, 502, 'Invalid image API response format')
  },
}
