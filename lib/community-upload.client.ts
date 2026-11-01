'use client'

import { validateCommunityUpload } from './community-validation'
import type { CommunitySection } from './community-types'
import { supabaseConfig } from './supabase/config'
import { communityBrowserClient } from './supabase/client'

const mimeByExtension: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', zip: 'application/zip', json: 'application/json', md: 'text/markdown', txt: 'text/plain', log: 'text/plain' }
export function communityFileMetadata(file: Pick<File, 'name' | 'type' | 'size'>, section: CommunitySection) {
  // Browsers commonly omit MIME types for ZIP, JSON and Markdown. This is only
  // preflight metadata; the server still checks the actual stored bytes.
  const mime = !file.type || file.type === 'application/octet-stream' ? mimeByExtension[file.name.split('.').pop()?.toLowerCase() || ''] || '' : file.type.toLowerCase()
  const metadata = { name: file.name, mime, bytes: file.size }
  validateCommunityUpload(metadata, section)
  return metadata
}

export interface UploadReservation { id: string; bucket: string; storageKey: string; mime: string; bytes: number }

/** One transfer, no automatic retries. Credentials stay in request headers. */
export async function transferCommunityFile(file: File, ticket: UploadReservation, onProgress: (percent: number) => void) {
  const config = supabaseConfig(), client = communityBrowserClient()
  if (!config || !client) throw new Error('UPLOAD_NOT_CONFIGURED')
  const { data: { session }, error } = await client.auth.getSession()
  if (error || !session) throw new Error('SIGN_IN_REQUIRED')
  // The path must be the server-issued reservation for this signed-in user.
  if (ticket.bucket !== 'community-media' || !ticket.storageKey.startsWith(`${session.user.id}/`) || ticket.storageKey.includes('..') || ticket.bytes !== file.size) throw new Error('INVALID_RESERVATION')
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${config.url}/storage/v1/object/${ticket.bucket}/${ticket.storageKey.split('/').map(encodeURIComponent).join('/')}`)
    xhr.timeout = 120_000
    xhr.setRequestHeader('apikey', config.key)
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`)
    xhr.setRequestHeader('Content-Type', ticket.mime)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(100, Math.round(event.loaded / event.total * 100))) }
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('TRANSFER_FAILED'))
    xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new Error('TRANSFER_FAILED'))
    xhr.send(file)
  })
}
