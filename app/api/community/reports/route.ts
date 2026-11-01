import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { assertPublicText } from '@/lib/community-validation'
import { communitySameOrigin, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
const columns = 'id,post_id,status,created_at'

export async function GET() {
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to view your reports.' }, { status: 401, headers })
    const { data, error } = await client.from('community_reports').select(columns).eq('reporter_id', user.id).order('created_at', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ error: 'Could not load your reports.' }, { status: 503, headers })
    return NextResponse.json({ reports: data || [] }, { headers })
  } catch { return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers }) }
}

export async function POST(request: Request) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in before reporting a post.' }, { status: 401, headers })
    let postId: string, reason: string
    try {
      const body = await readCommunityJson(request) as Record<string, unknown>
      if (typeof body?.postId !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(body.postId) || typeof body.reason !== 'string') throw new Error('invalid-report')
      postId = body.postId; reason = body.reason.trim()
      if (!reason || reason.length > 2000) throw new Error('invalid-report')
      assertPublicText(reason)
    } catch (error) {
      return NextResponse.json({ error: 'Check the report text and remove any credentials.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers })
    }
    const existing = await client.from('community_posts').select('id').eq('id', postId).eq('moderation', 'published').maybeSingle()
    if (existing.error) return NextResponse.json({ error: 'Could not check this post.' }, { status: 503, headers })
    if (!existing.data) return NextResponse.json({ error: 'Public post not found.' }, { status: 404, headers })
    const { data, error } = await client.from('community_reports').insert({ reporter_id: user.id, post_id: postId, reason }).select(columns).single()
    if (error?.code === '23505') return NextResponse.json({ error: 'You have already reported this post.' }, { status: 409, headers })
    if (error) return NextResponse.json({ error: 'Could not submit this report.' }, { status: 503, headers })
    return NextResponse.json({ report: data }, { status: 201, headers })
  } catch { return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers }) }
}
