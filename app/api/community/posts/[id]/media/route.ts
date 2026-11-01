import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communityResponseHeaders as headers } from '@/lib/community-http'
import { COMMUNITY_MAX_FILE_BYTES } from '@/lib/community-validation'

export const dynamic = 'force-dynamic'
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
const mediaColumns = 'media_id,media:community_media(id,owner_id,kind,storage_key,bytes,duration_seconds,sha256,verified_at,original_name)'
interface Media { id: string; owner_id: string; kind: string; storage_key: string; bytes: number; duration_seconds: number | null; sha256: string | null; verified_at: string | null; original_name?: string | null }
interface Attachment { media_id: string; media: Media | null }
function verified(media: Media | null): media is Media {
  return !!media && typeof media.verified_at === 'string' && Number.isFinite(Date.parse(media.verified_at))
    && typeof media.sha256 === 'string' && /^[a-f\d]{64}$/.test(media.sha256)
    && Number.isSafeInteger(media.bytes) && media.bytes > 0 && media.bytes <= COMMUNITY_MAX_FILE_BYTES
    && typeof media.storage_key === 'string' && uuid.test(media.owner_id)
    && media.storage_key.startsWith(`${media.owner_id}/`) && !media.storage_key.includes('..') && /^[a-z\d_./-]+$/i.test(media.storage_key)
}
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const mediaId = new URL(request.url).searchParams.get('mediaId')
    const download = new URL(request.url).searchParams.get('download') === '1'
    if (!uuid.test(id) || mediaId !== null && !uuid.test(mediaId)) return NextResponse.json({ error: 'Invalid media reference.' }, { status: 400, headers })
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ configured: false, error: 'Community is not configured.' }, { status: 503, headers })
    const identity = await client.auth.getUser()
    if (identity.error && identity.error.name !== 'AuthSessionMissingError') return NextResponse.json({ error: 'Could not verify your session.' }, { status: 401, headers })
    // Every lookup uses the caller's JWT and database RLS, including anonymous public reads.
    const post = await client.from('community_posts').select('id,owner_id,moderation,reuse').eq('id', id).maybeSingle()
    if (post.error) return NextResponse.json({ error: 'Could not check this post.' }, { status: 503, headers })
    if (!post.data) return NextResponse.json({ error: 'Post not found.' }, { status: 404, headers })
    let canDownload = post.data.moderation === 'published' && ['download','remix-with-credit'].includes(post.data.reuse)
      || !!identity.data.user && post.data.owner_id === identity.data.user.id
    if (!canDownload && identity.data.user) {
      const role = await client.rpc('community_is_moderator')
      if (role.error) return NextResponse.json({ error: 'Could not check download permissions.' }, { status: 503, headers })
      canDownload = role.data === true
    }
    const query = client.from('community_post_media').select(mediaColumns).eq('post_id', id)
    if (!mediaId) {
      const { data, error } = await query.limit(31)
      if (error) return NextResponse.json({ error: 'Could not load post media.' }, { status: 503, headers })
      const attachments = (data || []) as unknown as Attachment[]
      if (attachments.length > 30) return NextResponse.json({ error: 'This post exceeds the attachment limit.' }, { status: 400, headers })
      return NextResponse.json({ media: attachments.map(item => ({ id: item.media_id, kind: item.media?.kind || null,
        bytes: item.media?.bytes || null, durationSeconds: item.media?.duration_seconds ?? null, verified: verified(item.media), canDownload,
      })) }, { headers })
    }
    const { data, error } = await query.eq('media_id', mediaId).maybeSingle()
    if (error) return NextResponse.json({ error: 'Could not check this media.' }, { status: 503, headers })
    const item = (data as unknown as Attachment | null)?.media || null
    if (!verified(item)) return NextResponse.json({ error: 'Verified media not found.' }, { status: 404, headers })
    if (download) {
      if (!canDownload) return NextResponse.json({ error: 'This post does not permit downloads.' }, { status: 403, headers })
      const allowed: Record<string, RegExp> = { image: /\.(png|jpe?g|webp|gif)$/i, video: /\.(mp4|webm)$/i, audio: /\.(mp3|wav|ogg)$/i, 'game-zip': /\.zip$/i, 'game-spec': /\.json$/i, report: /\.(md|txt|log)$/i }
      if (!allowed[item.kind]?.test(item.storage_key)) return NextResponse.json({ error: 'Unsupported attachment format.' }, { status: 400, headers })
      const extension = item.storage_key.split('.').pop()!.toLowerCase()
      const filename = `pixel-world-${item.id}.${extension}`
      const signed = await client.storage.from('community-media').createSignedUrl(item.storage_key, 300, { download: filename })
      if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: 'Attachment download is unavailable.' }, { status: 503, headers })
      return NextResponse.json({ id: item.id, kind: item.kind, url: signed.data.signedUrl, filename, sha256: item.sha256, bytes: item.bytes, expiresInSeconds: 300 }, { headers })
    }
    const extensions: Record<string, RegExp> = { image: /\.(png|jpe?g|webp|gif)$/i, video: /\.(mp4|webm)$/i, audio: /\.(mp3|wav|ogg)$/i }
    if (!extensions[item.kind]?.test(item.storage_key)) return NextResponse.json({ error: 'This attachment does not support media preview.' }, { status: 400, headers })
    const signed = await client.storage.from('community-media').createSignedUrl(item.storage_key, 300)
    if (signed.error || !signed.data?.signedUrl) return NextResponse.json({ error: 'Media preview is unavailable.' }, { status: 503, headers })
    return NextResponse.json({ id: item.id, kind: item.kind, url: signed.data.signedUrl, expiresInSeconds: 300 }, { headers })
  } catch { return NextResponse.json({ error: 'Media preview is unavailable.' }, { status: 503, headers }) }
}
