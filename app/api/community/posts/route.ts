import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { createCommunityDraft } from '@/lib/community-validation'
import { ARTWORK_KINDS } from '@/lib/community-types'
import { profileColumns, publicAuthor, type ProfileRow } from '@/lib/community-profile'
import { communitySameOrigin, communityPostColumns as columns, communityResponseHeaders as headers, readCommunityJson } from '@/lib/community-http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ configured: false, posts: [] }, { headers })
    const url = new URL(request.url), section = url.searchParams.get('section') || 'workshop'
    if (!['workshop', 'art'].includes(section)) return NextResponse.json({ error: 'Invalid section.' }, { status: 400, headers })
    const artKind = url.searchParams.get('artKind')
    if (artKind && (section !== 'art' || !ARTWORK_KINDS.includes(artKind as typeof ARTWORK_KINDS[number]))) return NextResponse.json({ error: 'Invalid artwork category.' }, { status: 400, headers })
    const gameId = url.searchParams.get('gameId'), search = url.searchParams.get('search')?.trim() || ''
    if (gameId && (section !== 'workshop' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(gameId)) || search.length > 80) return NextResponse.json({ error: 'Invalid game reference or search.' }, { status: 400, headers })
    let query = client.from('community_posts').select(`${columns},attachments:community_post_media(media_id)`).eq('section', section).order('created_at', { ascending: false }).limit(20)
    if (artKind) query = query.eq('art_kind', artKind)
    if (gameId) query = query.eq('id', gameId)
    if (search) query = query.ilike('title', `%${search.replace(/[\\%_]/g, '\\$&')}%`)
    if (url.searchParams.get('mine') === '1') {
      const { data: { user } } = await client.auth.getUser()
      if (!user) return NextResponse.json({ error: 'Sign in to view your drafts.' }, { status: 401, headers })
      query = query.eq('owner_id', user.id)
    } else query = query.eq('moderation', 'published')
    const { data, error } = await query
    if (error) return NextResponse.json({ error: 'Could not load community posts.' }, { status: 503, headers })
    const posts = data || []
    const authorIds = [...new Set(posts.map(post => post.owner_id))]
    const authors = authorIds.length ? await client.from('community_profiles').select(profileColumns).in('id',authorIds).limit(20) : { data: [], error: null }
    if (authors.error) return NextResponse.json({ error: 'Could not load author profiles.' }, { status: 503, headers })
    const profiles = new Map((authors.data || []).map(profile => [profile.id, profile as ProfileRow]))
    const attributed = posts.map(post => ({ ...post, author: publicAuthor(post.owner_id,profiles.get(post.owner_id)) }))
    const relatedIds = [...new Set(posts.map(post => post.linked_game_id).filter((id): id is string => typeof id === 'string'))]
    if (section === 'art' && relatedIds.length) {
      // One bounded lookup, using caller RLS and a public-state filter; no N+1
      // preview requests and no private game titles in artwork responses.
      const games = await client.from('community_posts').select('id,title,language').eq('section','workshop').eq('moderation','published').in('id',relatedIds).limit(20)
      const available = new Map((games.error ? [] : games.data || []).map(game => [game.id, game]))
      return NextResponse.json({ configured: true, posts: attributed.map(post => ({ ...post, linked_game: available.get(post.linked_game_id) || null })) }, { headers })
    }
    return NextResponse.json({ configured: true, posts: attributed }, { headers })
  } catch {
    return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers })
  }
}

export async function POST(request: Request) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user } } = await client.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Sign in before posting.' }, { status: 401, headers })
    let post
    try {
      const body = await readCommunityJson(request)
      post = createCommunityDraft(body as Parameters<typeof createCommunityDraft>[0], { userId: user.id }, crypto.randomUUID(), new Date().toISOString())
      // File attachment and experiment import use separate verified endpoints.
      if (post.mediaIds.length || post.experimentId) return NextResponse.json({ error: 'Use the verified experiment and media import before attaching files.' }, { status: 400, headers })
    } catch (error) {
      if (error instanceof Error && error.message === 'body-too-large') return NextResponse.json({ error: 'Post text is too large.' }, { status: 413, headers })
      return NextResponse.json({ error: 'Check the post fields and remove any credentials.' }, { status: 400, headers })
    }
    const { data, error } = await client.from('community_posts').insert({ owner_id: user.id, section: post.section,
      language: post.language, title: post.title, description: post.description, experiment_id: null,
      rights: post.rights, license_note: post.licenseNote, reuse: post.reuse, art_kind: post.artKind, linked_game_id: post.linkedGameId }).select(columns).single()
    if (error) return NextResponse.json({ error: 'Could not save this draft. Check its category and related published game.' }, { status: error.code === '22023' ? 400 : 503, headers })
    return NextResponse.json({ post: data }, { status: 201, headers })
  } catch {
    return NextResponse.json({ error: 'Community service is unavailable.' }, { status: 503, headers })
  }
}
