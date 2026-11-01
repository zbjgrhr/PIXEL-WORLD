import { describe, expect, it } from 'vitest'
import { communityAdminConfig } from './admin.server'

const config = { url: 'https://example.supabase.co', publicKey: 'sb_publishable_test_only', secret: 'sb_secret_test_only' }
describe('server-only upload verification configuration', () => {
  it('stays unavailable until both public and private configuration exist', () => {
    expect(communityAdminConfig({ ...config, secret: undefined })).toBeNull()
    expect(communityAdminConfig({ ...config, url: undefined })).toBeNull()
    expect(communityAdminConfig(config)).toEqual({ url: config.url, secret: config.secret })
  })
  it('never substitutes the browser key for a trusted verifier secret', () => {
    expect(() => communityAdminConfig({ ...config, secret: config.publicKey })).toThrow(/server secret/)
    expect(() => communityAdminConfig({ ...config, url: 'https://user:password@example.supabase.co' })).toThrow()
  })
  it('recognizes the legacy service-role format without claiming to authenticate that credential', () => {
    const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test-only-signature`
    expect(communityAdminConfig({ ...config, secret: jwt('service_role') })).toBeTruthy()
    expect(() => communityAdminConfig({ ...config, secret: jwt('anon') })).toThrow()
  })
})
