import sharp from 'sharp'
import { padImageToGrid, removeCheckerboardBackground, removeChromaGreenBackground } from '@/lib/image-cutout'
import type { CutoutMode } from '@/lib/game-prompts'

export class ImageQualityError extends Error {}

export async function readGeneratedImage(url: string): Promise<Buffer> {
  const data = url.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=\r\n]+)$/i)
  if (data) return Buffer.from(data[1], 'base64')
  if (!/^https?:\/\//i.test(url)) throw new ImageQualityError('图片地址无效。')
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new ImageQualityError(`图片下载失败（${response.status}）。`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > 16 * 1024 * 1024) throw new ImageQualityError('生成图片超过 16 MB，请降低生成尺寸。')
  return bytes
}

export interface SpriteImageCheck {
  width: number
  height: number
  frameCount: number
  transparentRatio: number
  frames: Array<{ coverage: number; borderCoverage: number }>
}

/** Inspect actual pixels before the engine is allowed to slice an image. */
export async function inspectSpriteImage(bytes: Buffer, frameCount = 1): Promise<SpriteImageCheck> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (info.width < frameCount * 32 || info.height < 32 || info.width % frameCount !== 0) {
    throw new ImageQualityError('图片尺寸不符合动作帧条要求，请重新生成。')
  }
  const cellWidth = info.width / frameCount
  const frames: SpriteImageCheck['frames'] = []
  const histograms: number[][] = []
  let transparent = 0
  for (let frame = 0; frame < frameCount; frame++) {
    let occupied = 0, edgeOccupied = 0, edgePixels = 0
    const histogram = Array<number>(64).fill(0)
    for (let y = 0; y < info.height; y++) for (let x = 0; x < cellWidth; x++) {
      const offset = (y * info.width + frame * cellWidth + x) * 4
      const foreground = data[offset + 3] > 64
      if (!foreground) transparent++
      else {
        occupied++
        const bin = (data[offset] >> 6) * 16 + (data[offset + 1] >> 6) * 4 + (data[offset + 2] >> 6)
        histogram[bin]++
      }
      if (x < 2 || x >= cellWidth - 2 || y < 2 || y >= info.height - 2) {
        edgePixels++
        if (foreground) edgeOccupied++
      }
    }
    const coverage = occupied / (cellWidth * info.height)
    const borderCoverage = edgeOccupied / Math.max(1, edgePixels)
    if (coverage < .004) throw new ImageQualityError(`第 ${frame + 1} 帧几乎没有角色，请重新生成这个动作。`)
    if (coverage > .86 || borderCoverage > .2) {
      throw new ImageQualityError(`第 ${frame + 1} 帧带有场景底图或角色越界；未采用这张图片，避免试玩时出现卡片和闪烁。`)
    }
    frames.push({ coverage, borderCoverage })
    histograms.push(histogram.map(value => value / Math.max(1, occupied)))
  }
  const transparentRatio = transparent / (info.width * info.height)
  if (transparentRatio < .14) throw new ImageQualityError('背景没有正确去除；未采用这张图片，请重新生成或上传透明素材。')
  for (let index = 1; index < histograms.length; index++) {
    const distance = histograms[0].reduce((sum, value, bin) => sum + Math.abs(value - histograms[index][bin]), 0) / 2
    if (distance > .65) throw new ImageQualityError(`第 ${index + 1} 帧的角色配色与第一帧差异过大；请重生成这个动作以保持角色一致。`)
  }
  return { width: info.width, height: info.height, frameCount, transparentRatio, frames }
}

/** Use one scale for the whole strip and a shared foot baseline, without stretching poses. */
export async function alignSpriteCells(bytes: Buffer, frameCount: number): Promise<Buffer> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const cellWidth = info.width / frameCount
  const boxes = Array.from({ length: frameCount }, (_, frame) => {
    let left = cellWidth, top = info.height, right = -1, bottom = -1
    for (let y = 0; y < info.height; y++) for (let x = 0; x < cellWidth; x++) {
      if (data[(y * info.width + frame * cellWidth + x) * 4 + 3] < 64) continue
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
    }
    if (right < left || bottom < top) throw new ImageQualityError('动作条存在空帧。')
    return { left: frame * cellWidth + left, top, width: right - left + 1, height: bottom - top + 1 }
  })
  const side = 512, baseline = 460
  const scale = Math.min(400 / Math.max(...boxes.map(box => box.height)), 440 / Math.max(...boxes.map(box => box.width)))
  const layers = await Promise.all(boxes.map(async (box, frame) => {
    const width = Math.max(1, Math.round(box.width * scale)), height = Math.max(1, Math.round(box.height * scale))
    return { input: await sharp(bytes).extract(box).resize(width, height, { kernel: 'nearest' }).png().toBuffer(), left: frame * side + Math.floor((side - width) / 2), top: baseline - height }
  }))
  return sharp({ create: { width: side * frameCount, height: side, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer()
}

export async function processGeneratedImage(url: string, options: {
  cutout: CutoutMode | null
  isolated: boolean
  preserveCanvas?: boolean
  frameCount?: number
  gridRows?: number
}): Promise<string> {
  let bytes = await readGeneratedImage(url)
  const meta = await sharp(bytes, { limitInputPixels: 4096 * 4096 }).metadata()
  if (!meta.width || !meta.height || meta.width < 32 || meta.height < 32) throw new ImageQualityError('图片数据不完整。')
  if (options.cutout === 'chroma-green') bytes = await removeChromaGreenBackground(bytes, options.preserveCanvas)
  else if (options.cutout === 'checkerboard') bytes = await removeCheckerboardBackground(bytes, options.preserveCanvas)
  else bytes = await sharp(bytes).png().toBuffer()
  if (options.preserveCanvas && options.frameCount) bytes = await padImageToGrid(bytes, options.frameCount, options.gridRows || 1)
  if (options.isolated && (!options.gridRows || options.gridRows === 1)) {
    await inspectSpriteImage(bytes, options.frameCount || 1)
    if (options.preserveCanvas) bytes = await alignSpriteCells(bytes, options.frameCount || 1)
  }
  return `data:image/png;base64,${bytes.toString('base64')}`
}
