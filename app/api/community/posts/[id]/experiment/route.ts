import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communityAdminClient } from '@/lib/supabase/admin.server'
import { communitySameOrigin, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'
import { importExperimentRecord } from '@/lib/community-experiment.server'
import type { CommunityMedia } from '@/lib/community-types'

export const dynamic = 'force-dynamic'
const uuid = /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i
type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params
    if (!uuid.test(id)) return NextResponse.json({ error: 'Invalid post.' }, { status: 400, headers })
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const identity = await client.auth.getUser()
    if (identity.error && identity.error.name !== 'AuthSessionMissingError') return NextResponse.json({ error: 'Could not verify your session.' }, { status: 401, headers })
    // Authorize the post with caller RLS before any privileged record lookup.
    const post = await client.from('community_posts').select('id,owner_id,language,experiment_id').eq('id', id).maybeSingle()
    if (post.error) return NextResponse.json({ error: 'Could not check this post.' }, { status: 503, headers })
    if (!post.data) return NextResponse.json({ error: 'Post not found.' }, { status: 404, headers })
    if (!post.data.experiment_id) return NextResponse.json({ record: null }, { headers })
    const admin = communityAdminClient()
    if (!admin) return NextResponse.json({ error: 'Experiment records are not configured.' }, { status: 503, headers })
    const saved = await admin.from('community_experiments').select('id,owner_id,language,record,validated_at').eq('id', post.data.experiment_id).eq('owner_id', post.data.owner_id).maybeSingle()
    if (saved.error) return NextResponse.json({ error: 'Could not load the experiment.' }, { status: 503, headers })
    if (!saved.data?.validated_at || saved.data.owner_id !== post.data.owner_id || saved.data.id !== post.data.experiment_id || saved.data.language !== post.data.language) return NextResponse.json({ error: 'A validated experiment record is not available.' }, { status: 409, headers })
    const snapshot = saved.data
    const files = await client.from('community_post_media').select('media:community_media(id,owner_id,run_id,kind,storage_key,sha256,bytes,duration_seconds,verified_at)').eq('post_id', id).limit(31)
    if (files.error) return NextResponse.json({ error: 'Could not check record evidence.' }, { status: 503, headers })
    let record
    try {
      const attachments: CommunityMedia[] = (files.data || []).map(entry => {
        const file = entry.media as unknown as { id: string; owner_id: string; run_id: string | null; kind: CommunityMedia['kind']; storage_key: string; sha256: string; bytes: number; duration_seconds: number | null; verified_at: string | null }
        if (!file || file.run_id !== snapshot.id) throw new Error('round')
        return { id: file.id, ownerId: file.owner_id, runId: null, kind: file.kind, storageKey: file.storage_key, sha256: file.sha256, bytes: file.bytes, durationSeconds: file.duration_seconds, verifiedAt: file.verified_at }
      })
      // Project a whitelist again. Legacy/internal JSON and unknown fields must
      // never become public merely because the post is readable.
      record = importExperimentRecord(snapshot.record, snapshot.owner_id, snapshot.id, attachments)
      if (record.language !== post.data.language) throw new Error('language')
    } catch { return NextResponse.json({ error: 'The record or its evidence has changed and needs review.' }, { status: 409, headers }) }
    return NextResponse.json({ record, source: 'author-reported', independentReview: 'not-verified' }, { headers })
  } catch { return NextResponse.json({ error: 'Experiment records are unavailable.' }, { status: 503, headers }) }
}

export async function POST(request: Request, context: Context) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const { id } = await context.params
    if (!uuid.test(id)) return NextResponse.json({ error: 'Invalid post.' }, { status: 400, headers })
    const client = await communityServerClient(), admin = communityAdminClient()
    if (!client || !admin) return NextResponse.json({ error: 'Experiment import is not configured.' }, { status: 503, headers })
    const { data: { user }, error: identity } = await client.auth.getUser()
    if (identity || !user) return NextResponse.json({ error: 'Sign in before importing.' }, { status: 401, headers })
    let body: Record<string, unknown>
    try {
      body = await readCommunityJson(request) as Record<string, unknown>
      if (!body || typeof body.updatedAt !== 'string' || !Number.isFinite(Date.parse(body.updatedAt))) throw new Error('fields')
    } catch (error) { return NextResponse.json({ error: 'Check the experiment record.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers }) }
    const post = await client.from('community_posts').select('id,owner_id,language,section,moderation,experiment_id,updated_at').eq('id', id).eq('owner_id', user.id).maybeSingle()
    if (post.error) return NextResponse.json({ error: 'Could not check this draft.' }, { status: 503, headers })
    if (!post.data) return NextResponse.json({ error: 'Draft not found.' }, { status: 404, headers })
    if (post.data.updated_at !== body.updatedAt || post.data.section !== 'workshop' || post.data.moderation !== 'draft' || post.data.experiment_id) return NextResponse.json({ error: 'Import requires the current, unlinked workshop draft.' }, { status: 409, headers })
    const files = await client.from('community_post_media').select('media:community_media(id,owner_id,run_id,kind,storage_key,sha256,bytes,duration_seconds,verified_at)').eq('post_id', id).limit(31)
    if (files.error || files.data?.some(item => !item.media)) return NextResponse.json({ error: 'Could not check experiment attachments.' }, { status: 503, headers })
    const attachments: CommunityMedia[] = (files.data || []).map(entry => {
      const file = entry.media as unknown as { id: string; owner_id: string; run_id: string | null; kind: CommunityMedia['kind']; storage_key: string; sha256: string; bytes: number; duration_seconds: number | null; verified_at: string | null }
      return { id: file.id, ownerId: file.owner_id, runId: file.run_id, kind: file.kind, storageKey: file.storage_key, sha256: file.sha256, bytes: file.bytes, durationSeconds: file.duration_seconds, verifiedAt: file.verified_at }
    })
    let record
    try {
      record = importExperimentRecord(body.record, user.id, crypto.randomUUID(), attachments)
      if (record.language !== post.data.language) throw new Error('language')
    } catch { return NextResponse.json({ error: 'Check the record, verified attachment IDs, language, outcome, timing, costs and private information.' }, { status: 400, headers }) }
    const imported = await admin.rpc('community_import_experiment', { p_owner: user.id, p_post_id: id, p_expected_version: body.updatedAt, p_record: record })
    if (imported.error) return NextResponse.json({ error: 'Import was not confirmed. Refresh the post before taking another action.' }, { status: imported.error.code === '40001' ? 409 : imported.error.code === '42501' ? 404 : imported.error.code === '22023' ? 400 : 503, headers })
    return NextResponse.json({ post: imported.data, source: 'author-reported', templateReview: 'not-reviewed' }, { status: 201, headers })
  } catch { return NextResponse.json({ error: 'Import status could not be confirmed. Refresh before trying again.' }, { status: 503, headers }) }
}
