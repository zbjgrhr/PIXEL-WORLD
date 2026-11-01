import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { communityAdminConfig } from '@/lib/supabase/admin.server'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET() {
  try {
    const client = await communityServerClient()
    if (!client) return NextResponse.json({ configured: false, user: null }, { headers })
    const { data: { user }, error } = await client.auth.getUser()
    if (error && error.name !== 'AuthSessionMissingError') return NextResponse.json({ error: 'Could not verify the community session.' }, { status: 401, headers })
    let moderator = false
    if (user) {
      const result = await client.rpc('community_is_moderator')
      if (result.error) return NextResponse.json({ error: 'Could not verify community permissions.' }, { status: 503, headers })
      moderator = result.data === true
    }
    let uploadsConfigured = false
    try { uploadsConfigured = !!communityAdminConfig() } catch { /* A bad upload secret must not prevent text creation. */ }
    return NextResponse.json({ configured: true, user: user ? { id: user.id } : null, moderator, uploadsConfigured }, { headers })
  } catch {
    return NextResponse.json({ error: 'Community authentication is unavailable.' }, { status: 503, headers })
  }
}
