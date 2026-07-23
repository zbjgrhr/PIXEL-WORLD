import { bytesToDataUrl, getImageDimensions } from '@/lib/image-providers/dimensions'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'
import { UpstreamApiError } from '@/lib/image-providers/types'

function modelPath(model: string): string {
  return model.split('/').map((part) => encodeURIComponent(part)).join('/')
}

export const huggingfaceProvider: ImageProvider = {
  id: 'huggingface',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const { width, height } = getImageDimensions(params)
    const fastModel = /schnell|hyper-sd/i.test(params.model)
    const response = await fetch(
      `https://router.huggingface.co/hf-inference/models/${modelPath(params.model)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          inputs: params.prompt,
          parameters: {
            width,
            height,
            num_inference_steps: fastModel ? 4 : 30,
            ...(params.negativePrompt?.trim() ? { negative_prompt: params.negativePrompt.trim() } : {}),
          },
        }),
      },
    )
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok) {
      throw new UpstreamApiError('huggingface', params.model, response.status, await response.text())
    }
    if (!contentType.startsWith('image/')) {
      throw new UpstreamApiError('huggingface', params.model, 502, await response.text())
    }
    return bytesToDataUrl(await response.arrayBuffer(), contentType)
  },
}
