import type { AssetType, ProviderId } from '@/lib/image-providers/types'

function isGptImageModel(modelId?: string): boolean {
  return Boolean(modelId && /gpt-image/i.test(modelId))
}

function usesGptImageSizes(providerId: ProviderId, modelId?: string): boolean {
  if (providerId === 'openai') return true
  if (providerId === 'openrouter') return isGptImageModel(modelId)
  return false
}

export function getSizeForProvider(
  providerId: ProviderId,
  assetType: AssetType,
  modelId?: string,
): string {
  if (providerId === 'dashscope') {
    switch (assetType) {
      case 'background':
        return '1664*928'
      case 'character':
      case 'ground':
      case 'obstacle':
      default:
        return '1328*1328'
    }
  }

  if (usesGptImageSizes(providerId, modelId)) {
    switch (assetType) {
      case 'background':
        return '1536x1024'
      case 'character':
      case 'ground':
      case 'obstacle':
      default:
        return '1024x1024'
    }
  }

  switch (assetType) {
    case 'background':
      return '1792x1024'
    case 'character':
    case 'ground':
    case 'obstacle':
    default:
      return '1024x1024'
  }
}
