import { describe, expect, it } from 'vitest'
import { safeCommunityRedirect, supabaseConfig } from './config'

describe('community public configuration', () => {
  it('does not invent a backend when configuration is absent', () => {
    expect(supabaseConfig({ url: '', key: '' })).toBeNull()
  })
  it('accepts public configuration and rejects service-role and secret keys', () => {
    const url = 'https://project.supabase.co'
    expect(supabaseConfig({ url, key: 'sb_publishable_example' })?.url).toBe(url)
    const jwt = (role: string) => `eyJheader.${btoa(JSON.stringify({ role }))}.signature`
    expect(supabaseConfig({ url, key: jwt('anon') })).toBeTruthy()
    expect(() => supabaseConfig({ url, key: jwt('service_role') })).toThrow(/server secret/)
    expect(() => supabaseConfig({ url, key: 'sb_secret_example' })).toThrow(/server secret/)
    expect(() => supabaseConfig({ url: 'https://user:password@project.supabase.co', key: 'sb_publishable_example' })).toThrow(/credentials/)
  })
  it('does not send OAuth users to an external redirect', () => {
    for (const next of ['//evil.example', 'https://evil.example', '/community/../../elsewhere', null]) expect(safeCommunityRedirect(next)).toBe('/community')
    expect(safeCommunityRedirect('/community?section=art')).toBe('/community?section=art')
  })
})
