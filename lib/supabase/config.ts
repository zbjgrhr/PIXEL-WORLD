export interface SupabasePublicConfig { url: string; key: string }

/** Only publishable/legacy anon keys belong in NEXT_PUBLIC variables. */
export function supabaseConfig(values = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
}): SupabasePublicConfig | null {
  if (!values.url || !values.key) return null
  let url: URL
  try { url = new URL(values.url) } catch { throw new Error('Invalid Supabase project URL.') }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the Supabase project origin without credentials or paths.')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS for the Supabase project.')
  let isPublic = /^sb_publishable_[a-z\d_-]+$/i.test(values.key)
  if (!isPublic && values.key.startsWith('eyJ')) {
    try {
      const payload = values.key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      isPublic = JSON.parse(atob(payload)).role === 'anon'
    } catch { /* An invalid key is not public configuration. */ }
  }
  if (!isPublic) throw new Error('Use a publishable or anon key, never a server secret or service-role key.')
  return { url: url.origin, key: values.key }
}

export function safeCommunityRedirect(next: string | null) {
  return next === '/community' || next?.startsWith('/community?') ? next : '/community'
}
