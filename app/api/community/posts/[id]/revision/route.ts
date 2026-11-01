import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communitySameOrigin, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const { id } = await context.params
    let body: Record<string, unknown>
    try {
      body = await readCommunityJson(request) as Record<string, unknown>
      if (!uuid.test(id) || !body || !['withdraw','detach'].includes(body.action as string) || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))
        || body.action === 'detach' && (typeof body.mediaId !== 'string' || !uuid.test(body.mediaId))) throw new Error('invalid')
    } catch (error) { return NextResponse.json({ error: 'Check the revision request.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers }) }
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user }, error: identityError } = await client.auth.getUser()
    if (identityError || !user) return NextResponse.json({ error: 'Sign in to revise your posts.' }, { status: 401, headers })
    const args = { p_post_id: id, p_expected_version: body.updatedAt }
    const result = body.action === 'withdraw'
      ? await client.rpc('community_withdraw_post', args)
      : await client.rpc('community_detach_media', { ...args, p_media_id: body.mediaId })
    if (result.error) return NextResponse.json({ error: 'Revision was not saved. Refresh the post before trying again.' }, { status: result.error.code === '42501' ? 404 : result.error.code === '40001' ? 409 : 503, headers })
    return NextResponse.json({ post: result.data }, { headers })
  } catch { return NextResponse.json({ error: 'Revision status could not be confirmed. Refresh before taking another action.' }, { status: 503, headers }) }
}
