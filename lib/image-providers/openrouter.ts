import { getSizeForProvider } from '@/lib/map-size-for-provider'
import { callOpenAICompatibleImagesAPI } from '@/lib/image-providers/openai-compatible'
import type { GenerateImageParams, ImageProvider } from '@/lib/image-providers/types'

function getOpenRouterHeaders(): Record<string, string> {
  const referer =
    process.env.NEXT_PUBLIC_BASE_URL?.trim() || 'https://prompt-play-pixel-game.vercel.app'

  return {
    'HTTP-Referer': referer,
    'X-Title': 'Pixel World',
  }
}

export const openrouterProvider: ImageProvider = {
  id: 'openrouter',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const size =
      params.size ?? getSizeForProvider('openrouter', params.assetType, params.model)

    return callOpenAICompatibleImagesAPI(
      { ...params, size },
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        providerLabel: 'openrouter',
        extraHeaders: getOpenRouterHeaders(),
      },
    )
  },
}
