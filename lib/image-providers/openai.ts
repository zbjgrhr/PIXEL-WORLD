import { getSizeForProvider } from '@/lib/map-size-for-provider'
import { callOpenAICompatibleImagesAPI } from '@/lib/image-providers/openai-compatible'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'
import { UpstreamApiError } from '@/lib/image-providers/types'
import { readGeneratedImage } from '@/lib/image-quality.server'

export const openaiProvider: ImageProvider = {
  id: 'openai',

  async generateImage(params: GenerateImageParams): Promise<string> {
    if (/gpt-image/i.test(params.model)) {
      const isolated = params.assetType !== 'background' && params.assetType !== 'ground'
      const size = params.layout === 'animation-strip' && (params.frameCount || 1) > 1 ? '1536x1024' : params.assetType === 'background' ? '1536x1024' : '1024x1024'
      const body = {
        model: params.model, prompt: params.prompt, n: 1, size,
        quality: 'medium', background: isolated ? 'transparent' : 'opaque', output_format: 'png',
      }
      let requestBody: string | FormData = JSON.stringify(body)
      const headers: Record<string, string> = { Authorization: `Bearer ${params.apiKey}` }
      const references = params.referenceImages || []
      if (references.length) {
        const form = new FormData()
        for (const [key, value] of Object.entries(body)) form.append(key, String(value))
        for (const [index, url] of references.entries()) {
          const bytes = await readGeneratedImage(url)
          form.append('image[]', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), `reference-${index}.png`)
        }
        requestBody = form
      } else headers['Content-Type'] = 'application/json'
      const response = await fetch(`https://api.openai.com/v1/images/${references.length ? 'edits' : 'generations'}`, {
        method: 'POST', headers, body: requestBody, signal: params.signal ? AbortSignal.any([params.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      })
      if (!response.ok) throw new UpstreamApiError('openai', params.model, response.status, await response.text())
      const data = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> }
      const image = data.data?.[0]
      if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`
      if (image?.url) return image.url
      throw new UpstreamApiError('openai', params.model, 502, 'No generated image was returned.')
    }
    const size =
      params.size ?? getSizeForProvider('openai', params.assetType, params.model)

    return callOpenAICompatibleImagesAPI(
      { ...params, size },
      {
        baseUrl: 'https://api.openai.com/v1',
        providerLabel: 'openai',
      },
    )
  },
}
