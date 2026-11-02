import { animationIsComplete, createActionStripAnimation, normalizeAnimationSpec } from '@/lib/asset-catalog'
import type { AnimationClipPose, AssetDefinition } from '@/types'
import { usableSpriteClip, validSpriteClipGeometry } from './sprite-clip-browser'

const MAX_BYTES = 10 * 1024 * 1024
const MAX_SIDE = 4096

export async function readUploadedImage(file: File, frameCount = 1, isStrip = false): Promise<string> {
  const accepted = isStrip ? ['image/png', 'image/webp'] : ['image/png', 'image/jpeg', 'image/webp']
  if (!accepted.includes(file.type)) throw new Error(isStrip ? '动作帧条请上传 PNG 或 WebP 图片。' : '请上传 PNG、JPEG 或 WebP 图片。')
  if (file.size > MAX_BYTES) throw new Error('图片不能超过 10 MB。')
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('图片读取失败，请重试。'))
    reader.readAsDataURL(file)
  })
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('图片无法打开，请检查文件。'))
    image.src = url
  })
  if (!dimensions.width || !dimensions.height || dimensions.width > MAX_SIDE || dimensions.height > MAX_SIDE) {
    throw new Error('图片宽高都必须在 1–4096 像素之间。')
  }
  if (dimensions.width % frameCount !== 0) throw new Error(`横向帧条宽度必须能被 ${frameCount} 帧整除。`)
  if (isStrip) {
    if (!validSpriteClipGeometry(dimensions.width, dimensions.height, frameCount)) throw new Error('动作帧条的每格应接近正方形；请上传横向排列的完整角色帧。')
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('动作图片无法打开。'))
      element.src = url
    })
    if (!usableSpriteClip(image, frameCount)) throw new Error('动作图片带有背景或缺少透明边缘，请先抠图。')
  }
  return url
}

export function withUploadedStatic(asset: AssetDefinition, url: string): AssetDefinition {
  return { ...asset, kind: 'image', original: undefined, source:undefined, animation: undefined, url, status: 'success', error: undefined }
}

export function withUploadedClip(asset: AssetDefinition, pose: AnimationClipPose, url: string): AssetDefinition {
  const existing = asset.kind === 'spriteSheet' ? normalizeAnimationSpec(asset.animation) : null
  const animation = existing?.layoutVersion === 3 ? existing : createActionStripAnimation()
  const clips = { ...animation.clips }
  if (asset.kind === 'image' && asset.url) clips.idle = { ...clips.idle!, url: asset.url, status: 'success' }
  clips[pose] = { ...clips[pose]!, original:undefined,originalPages:undefined,frameRects:undefined,source:undefined,frameOrder:undefined,frameCount:[1,2,3].includes(clips[pose]!.frameCount)?clips[pose]!.frameCount:1, url, status: 'success' }
  const next: AssetDefinition = { ...asset, original:clips.idle?.original,source:undefined, kind: 'spriteSheet', animation: { ...animation, clips }, url: clips.idle?.url, error: undefined, status: 'pending' }
  return { ...next, status: animationIsComplete(next) ? 'success' : 'pending' }
}

export async function repeatImageAsStrip(url: string, frames: number): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('补齐动作时无法读取图片。'))
    element.src = url
  })
  const frameWidth = Math.min(image.naturalWidth, Math.floor(MAX_SIDE / frames))
  const frameHeight = Math.min(image.naturalHeight, MAX_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = frameWidth * frames
  canvas.height = frameHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法处理这张图片。')
  context.imageSmoothingEnabled = false
  for (let index = 0; index < frames; index += 1) context.drawImage(image, index * frameWidth, 0, frameWidth, frameHeight)
  return canvas.toDataURL('image/png')
}
