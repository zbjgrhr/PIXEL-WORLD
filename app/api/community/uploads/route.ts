import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { assertPublicText, validateCommunityUpload } from '@/lib/community-validation'
import { uploadClients, uploadDatabaseError, uploadIdPattern } from '@/lib/community-upload.server'
import { communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
export async function GET() {
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ configured: false, uploads: [] }, { headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to view uploads.' }, { status: 401, headers })
    const columns = 'id,post_id,original_name,kind,declared_bytes,state,media_id,expires_at,failure_code,created_at'
    const [recent, unfinished] = await Promise.all([
      client.from('community_uploads').select(columns).eq('owner_id', user.id).order('created_at', { ascending: false }).limit(50),
      // Old unfinished reservations must not disappear behind newer receipts.
      client.from('community_uploads').select(columns).eq('owner_id', user.id).or('state.in.(reserved,verifying,deleting),and(state.eq.complete,post_id.is.null)').order('created_at', { ascending: true }).limit(100),
    ])
    if (recent.error || unfinished.error) return NextResponse.json({ error: 'Could not load your uploads.' }, { status: 503, headers })
    const uploads = [...new Map([...(unfinished.data || []), ...(recent.data || [])].map(item => [item.id, item])).values()]
    return NextResponse.json({ configured: true, uploads }, { headers })
  } catch { return NextResponse.json({ error: 'Upload service is unavailable.' }, { status: 503, headers }) }
}
export async function POST(request: Request) {
  try {
    const auth = await uploadClients(request)
    if (auth.response) return auth.response
    let body: Record<string, unknown>, kind: string
    try {
      body = await readCommunityJson(request) as Record<string, unknown>
      if (typeof body?.postId !== 'string' || !uploadIdPattern.test(body.postId) || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt)) || typeof body.name !== 'string' || typeof body.mime !== 'string' || !Number.isSafeInteger(body.bytes)) throw new Error('metadata')
      assertPublicText(body.name)
      // The authoritative section comes from the owner's saved draft below.
      kind = validateCommunityUpload({ name: body.name, mime: body.mime, bytes: body.bytes as number }, 'workshop')
    } catch (error) { return NextResponse.json({ error: 'Check the filename, type, size, and private information.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers }) }
    const saved = await auth.client.from('community_posts').select('id,section,experiment_id').eq('id', body.postId).eq('owner_id', auth.user.id).maybeSingle()
    if (saved.error) return NextResponse.json({ error: 'Could not check this draft.' }, { status: 503, headers })
    if (!saved.data) return NextResponse.json({ error: 'Draft not found.' }, { status: 404, headers })
    if (saved.data.experiment_id) return NextResponse.json({ error: 'Experiment evidence is a snapshot. Use a new draft for changed evidence.' }, { status: 409, headers })
    if (saved.data.section === 'art' && !['image','video','audio'].includes(kind)) return NextResponse.json({ error: 'Artwork posts accept media only.' }, { status: 400, headers })
    const { data, error } = await auth.client.rpc('community_reserve_upload', { p_post_id: body.postId, p_expected_version: body.updatedAt,
      p_name: body.name, p_mime: (body.mime as string).toLowerCase(), p_kind: kind, p_extension: (body.name as string).split('.').pop()!.toLowerCase(), p_bytes: body.bytes })
    if (error) return uploadDatabaseError(error.code)
    const ticket = data as Record<string, unknown>
    return NextResponse.json({ upload: { id: ticket.id, postId: ticket.post_id, bucket: 'community-media', storageKey: ticket.storage_key,
      mime: ticket.mime_type, bytes: ticket.declared_bytes, state: ticket.state, expiresAt: ticket.expires_at } }, { status: 201, headers })
  } catch { return NextResponse.json({ error: 'Upload service is unavailable.' }, { status: 503, headers }) }
}
