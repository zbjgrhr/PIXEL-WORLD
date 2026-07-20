import { getSizeForProvider } from '@/lib/map-size-for-provider'
import { callOpenAICompatibleImagesAPI } from '@/lib/image-providers/openai-compatible'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'

export const openaiProvider: ImageProvider = {
  id: 'openai',

  async generateImage(params: GenerateImageParams): Promise<string> {
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
