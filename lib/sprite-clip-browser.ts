/** Reject square pictures and narrow slices before treating them as action strips. */
export function validSpriteClipGeometry(width: number, height: number, frameCount: number): boolean {
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 3 || width < 32 || height < 32) return false
  if (width % frameCount !== 0) return false
  const cellRatio = width / frameCount / height
  return cellRatio >= 0.65 && cellRatio <= 1.6
}

/** Character art must have transparent surroundings, not a painted scene card. */
export function usableSpriteClip(image: HTMLImageElement, frameCount: number): boolean {
  if (!validSpriteClipGeometry(image.naturalWidth, image.naturalHeight, frameCount)) return false
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 48; canvas.height = 48
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return false
    context.drawImage(image, 0, 0, 48, 48)
    const pixels = context.getImageData(0, 0, 48, 48).data
    let clear = 0
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] < 64) clear++
    return clear / (48 * 48) >= 0.08
  } catch { return false }
}
