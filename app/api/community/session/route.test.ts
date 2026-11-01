import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

const mocks = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn(), adminConfig: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ communityServerClient: mocks.client }))
vi.mock('@/lib/supabase/admin.server', () => ({ communityAdminConfig: mocks.adminConfig }))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({ data: { user: { id: 'verified-user' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: false, error: null })
  mocks.adminConfig.mockReturnValue(null)
  mocks.client.mockResolvedValue({ auth: { getUser: mocks.user }, rpc: mocks.rpc })
})
describe('community session identity and moderation role', () => {
  it('does not pretend an unconfigured backend has users', async () => {
    mocks.client.mockResolvedValueOnce(null)
    expect(await (await GET()).json()).toEqual({ configured: false, user: null })
  })
  it('allows anonymous browsing without querying privileged role data', async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { name: 'AuthSessionMissingError' } })
    expect(await (await GET()).json()).toEqual({ configured: true, user: null, moderator: false, uploadsConfigured: false })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('uses verified database role data rather than display names or user metadata', async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: 'verified-user', user_metadata: { moderator: true, display_name: '【IA】Introvert Arcade' } } }, error: null })
    expect(await (await GET()).json()).toEqual({ configured: true, user: { id: 'verified-user' }, moderator: false, uploadsConfigured: false })
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null })
    expect((await (await GET()).json()).moderator).toBe(true)
  })
  it('does not turn authentication or role verification errors into success', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: { name: 'BadToken' } })
    expect((await GET()).status).toBe(401)
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Unavailable' } })
    expect((await GET()).status).toBe(503)
  })
  it('returns only an upload-configuration flag, never the private server key', async () => {
    mocks.adminConfig.mockReturnValue({ url: 'https://example.supabase.co', secret: 'test-only-private-value' })
    const text = await (await GET()).text()
    expect(JSON.parse(text).uploadsConfigured).toBe(true)
    expect(text).not.toContain('test-only-private-value')
    expect(text).not.toContain('secret')
  })
})
