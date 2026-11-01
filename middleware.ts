import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { supabaseConfig } from '@/lib/supabase/config'

// Next.js 15 uses middleware.ts, not the Next.js 16 proxy.ts filename.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  response.headers.set('Cache-Control', 'private, no-store')
  let config
  try { config = supabaseConfig() } catch { return response }
  if (!config) return response
  const client = createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (items) => {
        for (const { name, value } of items) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        response.headers.set('Cache-Control', 'private, no-store')
        for (const { name, value, options } of items) response.cookies.set(name, value, options)
      },
    },
  })
  await client.auth.getClaims()
  return response
}

export const config = { matcher: ['/community/:path*', '/api/community/:path*', '/auth/:path*'] }
