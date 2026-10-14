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
  if (g > 70 && g > r * 2.2 && g > b * 2.2 && r < 85 && b < 85) return true
  if (g > 180 && g > r * 1.25 && g > b * 1.4 && r < 200 && b < 160) return true
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
  // Only remove background connected to the canvas edges. Removing every
  // white/green pixel also erased eyes, metallic highlights and costume detail.
  const background = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let head = 0, tail = 0
  const enqueue = (index: number) => {
    if (background[index]) return
    const offset = index * channels
    if (!isBackground(data[offset], data[offset + 1], data[offset + 2]) && !(channels === 4 && data[offset + 3] < 16)) return
    background[index] = 1
    queue[tail++] = index
  }
  for (let x = 0; x < width; x++) { enqueue(x); enqueue((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { enqueue(y * width); enqueue(y * width + width - 1) }
  while (head < tail) {
    const index = queue[head++], x = index % width
    if (x > 0) enqueue(index - 1)
    if (x < width - 1) enqueue(index + 1)
    if (index >= width) enqueue(index - width)
    if (index < pixelCount - width) enqueue(index + width)
  }

  // Large flat key-color pockets between legs/claws can be enclosed by the
  // sprite's outline. Match the actual edge key, keeping small costume details.
  if (isBackground === isChromaGreenPixel) {
    let red = 0, green = 0, blue = 0, count = 0
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 32))) {
      for (const y of [0, height - 1]) {
        const offset = (y * width + x) * channels
        if (isBackground(data[offset], data[offset + 1], data[offset + 2])) { red += data[offset]; green += data[offset + 1]; blue += data[offset + 2]; count++ }
      }
    }
    const key = count ? { r: red / count, g: green / count, b: blue / count } : { r: 0, g: 255, b: 0 }
    const visited = new Uint8Array(pixelCount)
    const candidate = (index: number) => {
      const offset = index * channels
      return !background[index] && isBackground(data[offset], data[offset + 1], data[offset + 2]) && colorDistance(data[offset], data[offset + 1], data[offset + 2], key) < 55
    }
    for (let start = 0; start < pixelCount; start++) {
      if (visited[start] || !candidate(start)) continue
      head = 0; tail = 0; queue[tail++] = start; visited[start] = 1
      const visit = (index: number) => { if (!visited[index] && candidate(index)) { visited[index] = 1; queue[tail++] = index } }
      while (head < tail) {
        const index = queue[head++], x = index % width
        if (x > 0) visit(index - 1)
        if (x < width - 1) visit(index + 1)
        if (index >= width) visit(index - width)
        if (index < pixelCount - width) visit(index + width)
      }
      if (tail > Math.max(1024, pixelCount * .002)) for (let i = 0; i < tail; i++) background[queue[i]] = 1
    }
    // Newly opened pockets also expose darker key-color fringes and shadows.
    head = 0; tail = 0
    for (let index = 0; index < pixelCount; index++) if (background[index]) queue[tail++] = index
    while (head < tail) {
      const index = queue[head++], x = index % width
      if (x > 0) enqueue(index - 1)
      if (x < width - 1) enqueue(index + 1)
      if (index >= width) enqueue(index - width)
      if (index < pixelCount - width) enqueue(index + width)
    }
  }

  for (let i = 0; i < pixelCount; i++) {
    const srcOffset = i * channels
    const dstOffset = i * 4

    const r = data[srcOffset]
    const g = data[srcOffset + 1]
    const b = data[srcOffset + 2]
    const a = channels === 4 ? data[srcOffset + 3] : 255

    if (background[i]) {
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
  preserveCanvas = false,
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

  return preserveCanvas ? cutout : trimTransparentBounds(cutout)
}

export async function removeCheckerboardBackground(imageBuffer: Buffer, preserveCanvas = false): Promise<Buffer> {
  return cutoutWithMask(imageBuffer, isCheckerboardPixel, preserveCanvas)
}

export async function removeChromaGreenBackground(imageBuffer: Buffer, preserveCanvas = false): Promise<Buffer> {
  return cutoutWithMask(imageBuffer, isChromaGreenPixel, preserveCanvas)
}

export async function padImageToGrid(imageBuffer: Buffer, columns: number, rows = columns): Promise<Buffer> {
  const metadata = await sharp(imageBuffer).metadata()
  if (!metadata.width || !metadata.height || columns < 1 || rows < 1) return imageBuffer
  const targetWidth = Math.ceil(metadata.width / columns) * columns
  const targetHeight = Math.ceil(metadata.height / rows) * rows
  const extraX = targetWidth - metadata.width
  const extraY = targetHeight - metadata.height
  if (!extraX && !extraY) return imageBuffer
  return sharp(imageBuffer)
    .extend({
      left: Math.floor(extraX / 2),
      right: Math.ceil(extraX / 2),
      top: Math.floor(extraY / 2),
      bottom: Math.ceil(extraY / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ quality: 100, compressionLevel: 6 })
    .toBuffer()
}
