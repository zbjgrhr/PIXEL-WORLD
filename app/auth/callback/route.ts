import { NextResponse } from 'next/server'
import { communityServerClient } from '@/lib/supabase/server'
import { safeCommunityRedirect } from '@/lib/supabase/config'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const client = await communityServerClient()
  if (code && client) {
    const { error } = await client.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(safeCommunityRedirect(url.searchParams.get('next')), url.origin), { headers: { 'Cache-Control': 'private, no-store' } })
  }
  return NextResponse.redirect(new URL('/community?authError=1', url.origin), { headers: { 'Cache-Control': 'private, no-store' } })
}
