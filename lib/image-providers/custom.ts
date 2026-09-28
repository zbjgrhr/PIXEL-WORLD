import { customImageResult, validateCustomBaseUrl } from '@/lib/custom-endpoint.server'
import { ProviderValidationError, type ImageProvider } from '@/lib/image-providers/types'

export const customImageProvider: ImageProvider = {
  id: 'custom',
  async generateImage(params) {
    if (!params.baseUrl) throw new ProviderValidationError('请先填写图片接口地址。', 'custom')
    return customImageResult(validateCustomBaseUrl(params.baseUrl), params.apiKey, {
      model: params.model,
      prompt: params.negativePrompt ? `${params.prompt}\nAvoid: ${params.negativePrompt}` : params.prompt,
      n: 1,
      size: params.size || '1024x1024',
    })
  },
}
