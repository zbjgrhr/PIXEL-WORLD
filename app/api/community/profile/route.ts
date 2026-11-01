import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communitySameOrigin, readCommunityJson, communityResponseHeaders as headers } from '@/lib/community-http'
import { profileColumns, profileInput, publicAuthor, type ProfileRow } from '@/lib/community-profile'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user }, error } = await client.auth.getUser()
    if (!user || error) return NextResponse.json({ error: 'Sign in to edit your profile.' }, { status: 401, headers })
    const [profile, images] = await Promise.all([
      client.from('community_profiles').select(profileColumns).eq('id', user.id).maybeSingle(),
      client.from('community_media').select('id,original_name').eq('owner_id', user.id).eq('kind','image')
        .not('verified_at','is',null).not('sha256','is',null).eq('frame_count',1).lte('bytes',5_000_000)
        .lte('pixel_width',4096).lte('pixel_height',4096).order('created_at',{ascending:false}).limit(100),
    ])
    if (profile.error || images.error) throw new Error('load')
    return NextResponse.json({ profile: profile.data, images: images.data || [], author: publicAuthor(user.id,profile.data as ProfileRow | null) }, { headers })
  } catch { return NextResponse.json({ error: 'Profile could not be loaded.' }, { status: 503, headers }) }
}

export async function PATCH(request: Request) {
  if (!communitySameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'Expected JSON.' }, { status: 415, headers })
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ error: 'Community is not configured.' }, { status: 503, headers })
    const { data: { user }, error: authError } = await client.auth.getUser()
    if (!user || authError) return NextResponse.json({ error: 'Sign in to edit your profile.' }, { status: 401, headers })
    let input
    try { input = profileInput(await readCommunityJson(request)) }
    catch { return NextResponse.json({ error: 'Check the name, image, and profile version.' }, { status: 400, headers }) }
    const { data, error } = await client.rpc('community_save_profile',input)
    if (error) return NextResponse.json({ error: error.code === '40001' ? 'Profile changed. Reload before saving.' : 'Profile was not saved. Check the image and public-avatar consent.' }, { status: error.code === '40001' ? 409 : error.code === '22023' ? 400 : 503, headers })
    return NextResponse.json({ profile: data, author: publicAuthor(user.id,data as ProfileRow) }, { headers })
  } catch { return NextResponse.json({ error: 'Profile could not be saved.' }, { status: 503, headers }) }
}
