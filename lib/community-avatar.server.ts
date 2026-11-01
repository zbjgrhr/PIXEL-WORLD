import sharp from 'sharp'
import { createHash } from 'node:crypto'

export async function avatarThumbnail(bytes: Buffer, expectedHash: string) {
  if (!bytes.length || bytes.length > 5_000_000 || !/^[a-f\d]{64}$/.test(expectedHash)
    || createHash('sha256').update(bytes).digest('hex') !== expectedHash) throw new Error('invalid-avatar')
  const source = sharp(bytes, { limitInputPixels: 4096 * 4096, failOn: 'warning' })
  const metadata = await source.metadata()
  if ((metadata.pages || 1) !== 1 || !metadata.width || metadata.width > 4096 || !metadata.height || metadata.height > 4096) throw new Error('invalid-avatar')
  // Auto-orient, crop and strip original metadata; never serve the private file.
  return source.rotate().resize(256,256,{fit:'cover'}).webp({quality:82}).toBuffer()
}
