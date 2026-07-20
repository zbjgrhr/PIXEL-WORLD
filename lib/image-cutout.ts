import sharp from 'sharp'

const CHECKER_COLORS = [
  { r: 204, g: 204, b: 204 },
  { r: 255, g: 255, b: 255 },
  { r: 192, g: 192, b: 192 },
  { r: 240, g: 240, b: 240 },
]

const CHECKER_THRESHOLD = 30

function colorDistance(
  r: number,
  g: number,
  b: number,
  target: { r: number; g: number; b: number },
): number {
  return Math.sqrt(
    (r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2,
  )
}

function isCheckerboardPixel(r: number, g: number, b: number): boolean {
  return CHECKER_COLORS.some((color) => colorDistance(r, g, b, color) < CHECKER_THRESHOLD)
}

function isChromaGreenPixel(r: number, g: number, b: number): boolean {
  // Primary chroma key #00FF00 and common model variants
  if (g > 180 && g > r * 1.6 && g > b * 1.6 && r < 120 && b < 120) return true
  return colorDistance(r, g, b, { r: 0, g: 255, b: 0 }) < 90
}

function applyAlphaMask(
  data: Buffer,
  channels: number,
  width: number,
  height: number,
  isBackground: (r: number, g: number, b: number) => boolean,
): Buffer {
  const pixelCount = width * height
  const processedData = Buffer.alloc(pixelCount * 4)

  for (let i = 0; i < pixelCount; i++) {
    const srcOffset = i * channels
    const dstOffset = i * 4

    const r = data[srcOffset]
    const g = data[srcOffset + 1]
    const b = data[srcOffset + 2]
    const a = channels === 4 ? data[srcOffset + 3] : 255

    if (isBackground(r, g, b)) {
      processedData[dstOffset] = r
      processedData[dstOffset + 1] = g
      processedData[dstOffset + 2] = b
      processedData[dstOffset + 3] = 0
    } else {
      processedData[dstOffset] = r
      processedData[dstOffset + 1] = g
      processedData[dstOffset + 2] = b
      processedData[dstOffset + 3] = a
    }
  }

  return processedData
}

async function trimTransparentBounds(imageBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width, height, channels } = info
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3]
      if (alpha > 16) {
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }

  if (minX >= maxX || minY >= maxY) {
    return imageBuffer
  }

  const padding = 4
  const left = Math.max(0, minX - padding)
  const top = Math.max(0, minY - padding)
  const cropWidth = Math.min(width - left, maxX - minX + 1 + padding * 2)
  const cropHeight = Math.min(height - top, maxY - minY + 1 + padding * 2)

  return sharp(imageBuffer)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .png()
    .toBuffer()
}

async function cutoutWithMask(
  imageBuffer: Buffer,
  isBackground: (r: number, g: number, b: number) => boolean,
): Promise<Buffer> {
  const image = sharp(imageBuffer)
  const { width, height } = await image.metadata()

  if (!width || !height) {
    throw new Error('Unable to get image dimensions')
  }

  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const processedData = applyAlphaMask(data, info.channels, width, height, isBackground)

  const cutout = await sharp(processedData, {
    raw: { width, height, channels: 4 },
  })
    .png({ quality: 100, compressionLevel: 6 })
    .toBuffer()

  return trimTransparentBounds(cutout)
}

export async function removeCheckerboardBackground(imageBuffer: Buffer): Promise<Buffer> {
  return cutoutWithMask(imageBuffer, isCheckerboardPixel)
}

export async function removeChromaGreenBackground(imageBuffer: Buffer): Promise<Buffer> {
  return cutoutWithMask(imageBuffer, isChromaGreenPixel)
}
