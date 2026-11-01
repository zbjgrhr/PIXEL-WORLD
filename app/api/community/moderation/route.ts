import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { assertPublicText } from '@/lib/community-validation'
import { communitySameOrigin, communityPostColumns, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
async function moderatorClient() {
  const client = await communityServerClient()
  if (!client) return { response: NextResponse.json({ code: 'COMMUNITY_NOT_CONFIGURED', error: 'Community is not configured.' }, { status: 503, headers }) }
  const { data: { user } } = await client.auth.getUser()
  if (!user) return { response: NextResponse.json({ error: 'Sign in first.' }, { status: 401, headers }) }
  const { data, error } = await client.rpc('community_is_moderator')
  if (error) return { response: NextResponse.json({ error: 'Could not verify moderation access.' }, { status: 503, headers }) }
  if (data !== true) return { response: NextResponse.json({ error: 'Moderator access required.' }, { status: 403, headers }) }
  return { client }
}

export async function GET() {
  try {
    const auth = await moderatorClient()
    if (auth.response) return auth.response
    const [posts, reports] = await Promise.all([
      auth.client.from('community_posts').select(`${communityPostColumns},attachments:community_post_media(media_id)`).eq('moderation', 'pending').order('updated_at', { ascending: true }).limit(20),
      auth.client.from('community_reports').select(`id,post_id,reason,status,created_at,post:community_posts(${communityPostColumns},attachments:community_post_media(media_id))`).eq('status', 'open').order('created_at', { ascending: true }).limit(20),
    ])
    if (posts.error || reports.error) return NextResponse.json({ error: 'Could not load the review queue.' }, { status: 503, headers })
    if ((reports.data || []).some(report => Array.isArray(report.post) && report.post.length > 1)) return NextResponse.json({ error: 'Could not resolve the reported post.' }, { status: 503, headers })
    const reportRows = (reports.data || []).map(report => ({ ...report, post: Array.isArray(report.post) ? report.post[0] || null : report.post }))
    const relatedIds = [...new Set([...(posts.data || []), ...reportRows.map(report => report.post)].map(post => post?.linked_game_id).filter((id): id is string => typeof id === 'string'))]
    if (relatedIds.length) {
      const games = await auth.client.from('community_posts').select('id,title,language').eq('section','workshop').eq('moderation','published').in('id',relatedIds).limit(40)
      const available = new Map((games.error ? [] : games.data || []).map(game => [game.id, game]))
      const attach = <T extends { linked_game_id?: string | null }>(post: T) => ({ ...post, linked_game: available.get(post.linked_game_id || '') || null })
      return NextResponse.json({ posts: (posts.data || []).map(attach), reports: reportRows.map(report => ({ ...report, post: report.post ? attach(report.post) : null })) }, { headers })
    }
    return NextResponse.json({ posts: posts.data || [], reports: reportRows }, { headers })
  } catch { return NextResponse.json({ error: 'Moderation service is unavailable.' }, { status: 503, headers }) }
}

export async function POST(request: Request) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const auth = await moderatorClient()
    if (auth.response) return auth.response
    let body: Record<string, unknown>
    try {
      body = await readCommunityJson(request) as Record<string, unknown>
      if (!body || typeof body.kind !== 'string' || !['post', 'report'].includes(body.kind) || typeof body.action !== 'string' || typeof body.id !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(body.id)
        || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000 || typeof body.version !== 'string'
        || (body.kind === 'post' ? !['approve', 'reject', 'hide'].includes(body.action) || !Number.isFinite(Date.parse(body.version)) : !['resolve', 'dismiss'].includes(body.action) || body.version !== 'open')) throw new Error('invalid-action')
      assertPublicText(body.reason)
    } catch (error) { return NextResponse.json({ error: 'Check the review fields and remove any credentials.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers }) }
    // A privileged reviewer must explicitly attest to the exact attachment set.
    if (body.kind === 'post' && body.action === 'approve') {
      if (body.reviewConfirmed !== true || !Array.isArray(body.reviewedMediaIds) || body.reviewedMediaIds.length > 30 || body.reviewedMediaIds.some(id => typeof id !== 'string')) return NextResponse.json({ error: 'Confirm your review of the content and attachments.' }, { status: 400, headers })
      const media = await auth.client.from('community_post_media').select('media_id,media:community_media(kind,verified_at,sha256)').eq('post_id', body.id).limit(31)
      if (media.error) return NextResponse.json({ error: 'Could not verify post attachments.' }, { status: 503, headers })
      const rows = (media.data || []) as unknown as { media_id: string; media: { kind: string; verified_at: string | null; sha256: string | null } | null }[]
      const ids = new Set(body.reviewedMediaIds)
      if (rows.length > 30 || ids.size !== rows.length || body.reviewedMediaIds.length !== rows.length || rows.some(row => !ids.has(row.media_id) || !row.media?.verified_at || !/^[a-f\d]{64}$/.test(row.media.sha256 || '') || !['image','video','audio','game-zip','game-spec','report'].includes(row.media.kind))) return NextResponse.json({ error: 'Review every verified attachment before approval.' }, { status: 400, headers })
    }
    const { data, error } = await auth.client.rpc('community_review', { p_kind: body.kind, p_subject_id: body.id, p_action: body.action, p_expected_version: body.version, p_reason: (body.reason as string).trim() })
    if (error) return NextResponse.json({ error: 'Review was not saved. Refresh the queue before trying again.' }, { status: error.code === '40001' ? 409 : error.code === '42501' ? 403 : error.code === '22023' ? 400 : 503, headers })
    return NextResponse.json({ decision: data }, { headers })
  } catch { return NextResponse.json({ error: 'Moderation service is unavailable.' }, { status: 503, headers }) }
}
