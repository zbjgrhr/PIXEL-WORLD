import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communityAdminClient } from '@/lib/supabase/admin.server'
import { avatarThumbnail } from '@/lib/community-avatar.server'

export const dynamic = 'force-dynamic'
const hidden = () => NextResponse.json({ error: 'Avatar is unavailable.' }, { status: 404, headers: { 'Cache-Control':'no-store' } })
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) return hidden()
    const client = await communityServerClient(), admin = communityAdminClient()
    if (!client || !admin) return hidden()
    const profile = await client.from('community_profiles').select('avatar_media_id').eq('id',id).maybeSingle()
    if (profile.error || !profile.data?.avatar_media_id) return hidden()
    // Public profile consent authorizes only this thumbnail, not arbitrary media.
    const file = await admin.from('community_media').select('owner_id,kind,storage_key,bytes,sha256,verified_at,frame_count').eq('id',profile.data.avatar_media_id).eq('owner_id',id).maybeSingle()
    const media = file.data
    if (file.error || !media || media.owner_id !== id || media.kind !== 'image' || !media.verified_at || media.frame_count !== 1 || media.bytes > 5_000_000
      || !media.storage_key.startsWith(`${id}/`) || media.storage_key.includes('..') || !media.sha256) return hidden()
    const object = await admin.storage.from('community-media').download(media.storage_key)
    if (object.error || !object.data || object.data.size !== media.bytes) return hidden()
    const thumbnail = await avatarThumbnail(Buffer.from(await object.data.arrayBuffer()),media.sha256)
    return new NextResponse(new Uint8Array(thumbnail), { headers: { 'Content-Type':'image/webp', 'Cache-Control':'public, max-age=60', 'X-Content-Type-Options':'nosniff', 'Content-Disposition':'inline; filename="avatar.webp"' } })
  } catch { return hidden() }
}
