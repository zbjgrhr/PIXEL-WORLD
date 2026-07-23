import { getImageDimensions, promptWithNegative } from '@/lib/image-providers/dimensions'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'
import { UpstreamApiError } from '@/lib/image-providers/types'

interface TogetherResponse {
  data?: Array<{ url?: string; b64_json?: string }>
}

export const togetherProvider: ImageProvider = {
  id: 'together',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const { width, height } = getImageDimensions(params)
    const isSchnell = /schnell/i.test(params.model)
    const supportsReferences = /FLUX\.2/i.test(params.model)
    const response = await fetch('https://api.together.xyz/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        prompt: promptWithNegative(params.prompt, supportsReferences ? undefined : params.negativePrompt),
        width,
        height,
        n: 1,
        response_format: 'base64',
        output_format: 'png',
        ...(isSchnell ? { steps: 4 } : {}),
        ...(!supportsReferences && params.negativePrompt?.trim()
          ? { negative_prompt: params.negativePrompt.trim() }
          : {}),
        ...(supportsReferences && params.referenceImages?.length
          ? { reference_images: params.referenceImages.slice(0, 4) }
          : {}),
      }),
    })
    if (!response.ok) {
      throw new UpstreamApiError('together', params.model, response.status, await response.text())
    }
    const payload = await response.json() as TogetherResponse
    const image = payload.data?.[0]
    if (image?.url) return image.url
    if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`
    throw new UpstreamApiError('together', params.model, 502, 'Invalid image API response format')
  },
}
