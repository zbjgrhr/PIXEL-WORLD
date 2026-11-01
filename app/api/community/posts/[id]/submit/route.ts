import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communitySameOrigin, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const { id } = await context.params
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) return NextResponse.json({ error: 'Invalid post.' }, { status: 400, headers })
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in before submission.' }, { status: 401, headers })
    let updatedAt: string
    try {
      const body = await readCommunityJson(request) as Record<string, unknown>
      if (typeof body?.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new Error('version')
      updatedAt = body.updatedAt
    } catch (error) { return NextResponse.json({ error: 'Invalid post version.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers }) }
    const { data, error } = await client.rpc('community_submit_post', { p_post_id: id, p_expected_updated_at: updatedAt })
    if (error) return NextResponse.json({ error: 'Submission failed. Refresh the post and check its media and language.' }, { status: error.code === '40001' ? 409 : error.code === '42501' ? 404 : error.code === '22023' ? 400 : 503, headers })
    return NextResponse.json({ post: data }, { headers })
  } catch { return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers }) }
}
