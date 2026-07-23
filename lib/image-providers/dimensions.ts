import type { GenerateImageParams } from '@/lib/image-providers/types'

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * Shared safe dimensions for providers that accept explicit pixel sizes.
 * Animation strips are horizontal so every frame receives a usable cell.
 */
export function getImageDimensions(params: GenerateImageParams): ImageDimensions {
  if (params.layout === 'animation-strip') {
    const frames = Math.max(1, Math.min(3, params.frameCount || 1))
    if (frames >= 2) return { width: 1024, height: 512 }
    return { width: 1024, height: 1024 }
  }

  if (params.assetType === 'background') return { width: 1024, height: 576 }
  return { width: 1024, height: 1024 }
}

export function promptWithNegative(prompt: string, negativePrompt?: string): string {
  if (!negativePrompt?.trim()) return prompt
  return `${prompt}\n\nStrict exclusions: ${negativePrompt.trim()}`
}

export function bytesToDataUrl(bytes: ArrayBuffer, contentType = 'image/png'): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
}
