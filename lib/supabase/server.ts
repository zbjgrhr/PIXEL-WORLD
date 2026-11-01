import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { supabaseConfig } from './config'

/** Create per request; never share a signed-in user's client between requests. */
export async function communityServerClient() {
  const config = supabaseConfig()
  if (!config) return null
  const jar = await cookies()
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) jar.set(name, value, options)
      },
    },
  })
}
