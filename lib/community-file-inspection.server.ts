import { createHash } from 'node:crypto'
import {inspectCommunityRaster} from './community-raster.server'
import { parseBuffer, TrackType } from 'music-metadata'
import { assertPublicText, COMMUNITY_MAX_FILE_BYTES, validateCommunityUpload } from './community-validation'
import { inspectCommunityArchive } from './community-archive.server'
import { checkedPublicText, checkSpecText, CommunityFileError } from './community-file-rules.server'
import type { CommunitySection, MediaKind } from './community-types'

export interface CommunityFileInspection {
  kind: MediaKind
  bytes: number
  sha256: string
  width: number | null
  height: number | null
  frames: number | null
  durationSeconds: number | null
  workLanguage: 'zh-CN' | 'en' | null
  levelCount: number | null
  archiveEntries: number | null
}

/** Type/content validation, not an artwork-quality score or malware certificate. */
export async function inspectCommunityFile(file: { name: string; mime: string; contents: Buffer }, section: CommunitySection): Promise<CommunityFileInspection> {
  try {
    const bytes = file.contents.length
    if (!bytes || bytes > COMMUNITY_MAX_FILE_BYTES) throw new CommunityFileError('LIMIT_EXCEEDED')
    try { assertPublicText(file.name); assertPublicText(file.contents.toString('latin1')) } catch { throw new CommunityFileError('PRIVATE_CONTENT') }
    const kind = validateCommunityUpload({ name: file.name, mime: file.mime, bytes }, section)
    const result: CommunityFileInspection = { kind, bytes, sha256: '', width: null, height: null, frames: null, durationSeconds: null, workLanguage: null, levelCount: null, archiveEntries: null }
    const extension = file.name.split('.').pop()!.toLowerCase()
    if (kind === 'image') {
      Object.assign(result,await inspectCommunityRaster(file.contents,extension))
    } else if (kind === 'audio' || kind === 'video') {
      const raw = file.contents
      const headerMatches = extension === 'mp4' ? raw.length > 12 && raw.toString('ascii', 4, 8) === 'ftyp'
        : extension === 'webm' ? raw.subarray(0, 4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
          : extension === 'wav' ? raw.length >= 44 && raw.toString('ascii', 0, 4) === 'RIFF' && raw.toString('ascii', 8, 12) === 'WAVE' && raw.readUInt32LE(4) + 8 === raw.length
            : extension === 'ogg' ? raw.toString('ascii', 0, 4) === 'OggS'
              : raw.toString('ascii', 0, 3) === 'ID3' || raw[0] === 255 && (raw[1] & 0xe0) === 0xe0
      if (!headerMatches) throw new CommunityFileError('TYPE_MISMATCH')
      const metadata = await parseBuffer(raw, { mimeType: file.mime, size: bytes }, { duration: true, skipCovers: true })
      checkedPublicText(new TextEncoder().encode(JSON.stringify({ common: metadata.common, native: metadata.native })))
      const durations = [metadata.format.containerDuration, metadata.format.duration, ...metadata.format.trackInfo.map(track => track.duration)].filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0)
      if (!durations.length) throw new CommunityFileError('INVALID_CONTENT')
      result.durationSeconds = Math.max(...durations)
      if (result.durationSeconds > 3600) throw new CommunityFileError('LIMIT_EXCEEDED')
      if (kind === 'video') {
        const track = metadata.format.trackInfo.find(track => track.type === TrackType.video && (track.video?.pixelWidth || 0) > 0 && (track.video?.pixelHeight || 0) > 0)
        if (!track?.video) throw new CommunityFileError('TYPE_MISMATCH')
        result.width = track.video.pixelWidth!; result.height = track.video.pixelHeight!
        if (result.width > 8192 || result.height > 8192 || result.width * result.height > 32_000_000) throw new CommunityFileError('LIMIT_EXCEEDED')
      } else if (!(metadata.format.sampleRate && metadata.format.numberOfChannels)) throw new CommunityFileError('INVALID_CONTENT')
    } else if (kind === 'game-zip') {
      const archive = await inspectCommunityArchive(file.contents)
      result.archiveEntries = archive.entries; result.workLanguage = archive.language; result.levelCount = archive.levelCount
    } else {
      const text = checkedPublicText(file.contents)
      if (kind === 'game-spec') { const spec = checkSpecText(text); result.workLanguage = spec.language; result.levelCount = spec.levelCount }
      else if (!text.trim() || text.includes('\0')) throw new CommunityFileError('INVALID_CONTENT')
    }
    result.sha256 = createHash('sha256').update(file.contents).digest('hex')
    return result
  } catch (error) {
    if (error instanceof CommunityFileError) throw error
    throw new CommunityFileError('INVALID_CONTENT')
  }
}
