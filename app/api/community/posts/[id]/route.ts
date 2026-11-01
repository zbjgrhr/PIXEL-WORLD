import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { createCommunityDraft } from '@/lib/community-validation'
import { communitySameOrigin, communityPostColumns, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }

async function changePost(request: Request, context: Context, remove: boolean) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  const { id } = await context.params
  if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)) return NextResponse.json({ error: 'Invalid post.' }, { status: 400, headers })
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in to change your posts.' }, { status: 401, headers })
    const result = await client.from('community_posts').select(communityPostColumns).eq('id', id).eq('owner_id', user.id).maybeSingle()
    if (result.error) return NextResponse.json({ error: 'Could not load this post.' }, { status: 503, headers })
    // Do not disclose whether another author's private post exists.
    if (!result.data) return NextResponse.json({ error: 'Post not found.' }, { status: 404, headers })
    const current = result.data
    let input: Record<string, unknown>
    try {
      const parsed = await readCommunityJson(request)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-body')
      input = parsed as Record<string, unknown>
    } catch (error) {
      return NextResponse.json({ error: 'Invalid post fields.' }, { status: error instanceof Error && error.message === 'body-too-large' ? 413 : 400, headers })
    }
    if (typeof input.updatedAt !== 'string' || input.updatedAt !== current.updated_at) return NextResponse.json({ error: 'This post changed. Reload before editing or deleting it.' }, { status: 409, headers })
    if (remove) {
      const { data, error } = await client.from('community_posts').delete().eq('id', id).eq('owner_id', user.id).eq('updated_at', current.updated_at).select('id')
      if (error) return NextResponse.json({ error: 'Could not delete this post.' }, { status: 503, headers })
      if (!data?.length) return NextResponse.json({ error: 'This post changed. Reload before deleting it.' }, { status: 409, headers })
      // Only the post and its attachment links are removed. Shared file bytes remain.
      return new NextResponse(null, { status: 204, headers })
    }
    let post
    try {
      // Untrusted JSON crosses the type boundary here; createCommunityDraft validates it.
      post = createCommunityDraft({ ...input, section: current.section, experimentId: null, mediaIds: [], artKind: input.artKind === undefined ? current.art_kind || 'other' : input.artKind, linkedGameId: input.linkedGameId === undefined ? current.linked_game_id || null : input.linkedGameId } as unknown as Parameters<typeof createCommunityDraft>[0], { userId: user.id }, id, new Date().toISOString())
      if (current.experiment_id && post.language !== current.language) throw new Error('linked-language')
    } catch {
      return NextResponse.json({ error: 'Check the post fields and remove any credentials. Linked experiments retain their original language.' }, { status: 400, headers })
    }
    const { data, error } = await client.from('community_posts').update({ title: post.title, description: post.description,
      language: post.language, rights: post.rights, license_note: post.licenseNote, reuse: post.reuse,
      art_kind: post.artKind, linked_game_id: post.linkedGameId,
    }).eq('id', id).eq('owner_id', user.id).eq('updated_at', current.updated_at).select(communityPostColumns).maybeSingle()
    if (error) return NextResponse.json({ error: 'Could not save this post. Check its category and related published game.' }, { status: error.code === '22023' ? 400 : 503, headers })
    if (!data) return NextResponse.json({ error: 'This post changed. Reload before editing it.' }, { status: 409, headers })
    return NextResponse.json({ post: data }, { headers })
  } catch {
    return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers })
  }
}

export const PATCH = (request: Request, context: Context) => changePost(request, context, false)
export const DELETE = (request: Request, context: Context) => changePost(request, context, true)
