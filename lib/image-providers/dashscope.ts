import { getSizeForProvider } from '@/lib/map-size-for-provider'
import {
  GenerateImageParams,
  UpstreamApiError,
  type ImageProvider,
} from '@/lib/image-providers/types'

const DASHSCOPE_API_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'

async function callDashScopeOnce(
  prompt: string,
  negativePrompt: string | undefined,
  apiKey: string,
  model: string,
  size: string,
): Promise<string> {
  const response = await fetch(DASHSCOPE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: prompt }],
          },
        ],
      },
      parameters: {
        negative_prompt: negativePrompt,
        prompt_extend: true,
        watermark: false,
        size,
      },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new UpstreamApiError('dashscope', model, response.status, errorText)
  }

  const result = await response.json()
  const imageUrl =
    result.output?.choices?.[0]?.message?.content?.[0]?.image

  if (!imageUrl) {
    throw new UpstreamApiError('dashscope', model, 502, 'Invalid API response format')
  }

  return imageUrl
}

export const dashscopeProvider: ImageProvider = {
  id: 'dashscope',

  async generateImage(params: GenerateImageParams): Promise<string> {
    const size =
      params.size ?? getSizeForProvider('dashscope', params.assetType, params.model)
    const maxRetries = 3
    const baseDelay = 2000

    for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
      try {
        return await callDashScopeOnce(
          params.prompt,
          params.negativePrompt,
          params.apiKey,
          params.model,
          size,
        )
      } catch (error) {
        if (
          error instanceof UpstreamApiError &&
          error.status === 429 &&
          retryCount < maxRetries
        ) {
          const delay = baseDelay * Math.pow(2, retryCount)
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        throw error
      }
    }

    throw new UpstreamApiError('dashscope', params.model, 429, 'Max retries exceeded')
  },
}
