import { createClient } from '@supabase/supabase-js'
import { supabaseConfig } from './config'

/** Never import this module into a client component or return its config. */
export function communityAdminConfig(values = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publicKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  secret: process.env.SUPABASE_SECRET_KEY,
}) {
  const config = supabaseConfig({ url: values.url, key: values.publicKey })
  if (!config || !values.secret) return null
  let trusted = /^sb_secret_[a-z\d_-]+$/i.test(values.secret)
  if (!trusted && values.secret.startsWith('eyJ')) {
    try { trusted = JSON.parse(Buffer.from(values.secret.split('.')[1], 'base64url').toString('utf8')).role === 'service_role' } catch { /* Invalid configuration stays unavailable. */ }
  }
  if (!trusted) throw new Error('Use a server secret for trusted file verification.')
  return { url: config.url, secret: values.secret }
}

export function communityAdminClient() {
  const config = communityAdminConfig()
  if (!config) return null
  return createClient(config.url, config.secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) }) },
  })
}
