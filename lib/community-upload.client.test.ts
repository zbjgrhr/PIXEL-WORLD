import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { communityFileMetadata, transferCommunityFile } from './community-upload.client'

const mocks = vi.hoisted(() => ({ config: vi.fn(), client: vi.fn(), session: vi.fn() }))
vi.mock('./supabase/config', () => ({ supabaseConfig: mocks.config }))
vi.mock('./supabase/client', () => ({ communityBrowserClient: mocks.client }))
const owner = '11111111-1111-4111-8111-111111111111'
let calls: FakeXHR[]
let outcome: 'ok' | 'error' | 'timeout' | 'reject'
class FakeXHR {
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  timeout = 0
  status = 200
  onload?: () => void
  onerror?: () => void
  ontimeout?: () => void
  onabort?: () => void
  headers: Record<string, string> = {}
  method = ''; url = ''; body?: File
  constructor() { calls.push(this) }
  open(method: string, url: string) { this.method = method; this.url = url }
  setRequestHeader(key: string, value: string) { this.headers[key] = value }
  send(body: File) {
    this.body = body
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 })
    if (outcome === 'error') this.onerror?.()
    else if (outcome === 'timeout') this.ontimeout?.()
    else { this.status = outcome === 'reject' ? 403 : 200; this.onload?.() }
  }
}
const file = () => new File(['image bytes'], 'sprite.png', { type: 'image/png' })
const ticket = () => ({ id: 'ticket', bucket: 'community-media', storageKey: `${owner}/ticket.png`, mime: 'image/png', bytes: file().size })
beforeEach(() => {
  calls = []; outcome = 'ok'; vi.clearAllMocks()
  mocks.config.mockReturnValue({ url: 'https://project.example', key: 'public-browser-key' })
  mocks.session.mockResolvedValue({ data: { session: { user: { id: owner }, access_token: 'test-session-only' } }, error: null })
  mocks.client.mockReturnValue({ auth: { getSession: mocks.session } })
  vi.stubGlobal('XMLHttpRequest', FakeXHR)
})
afterEach(() => vi.unstubAllGlobals())
describe('community file selection and one-shot transfer', () => {
  it('handles missing browser MIME metadata but rejects incompatible MIME and artwork archives', () => {
    expect(communityFileMetadata({ name: 'game.zip', type: '', size: 100 }, 'workshop').mime).toBe('application/zip')
    expect(communityFileMetadata({ name: 'report.md', type: 'application/octet-stream', size: 100 }, 'workshop').mime).toBe('text/markdown')
    expect(() => communityFileMetadata({ name: 'sprite.png', type: 'text/plain', size: 100 }, 'art')).toThrow()
    expect(() => communityFileMetadata({ name: 'game.zip', type: '', size: 100 }, 'art')).toThrow()
    expect(() => communityFileMetadata({ name: 'large.png', type: 'image/png', size: 45_000_001 }, 'art')).toThrow()
  })
  it('transfers only to the reserved private object, without placing credentials in URLs or bodies', async () => {
    const progress = vi.fn(), original = file()
    await transferCommunityFile(original, ticket(), progress)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`https://project.example/storage/v1/object/community-media/${owner}/ticket.png`)
    expect(calls[0].headers['x-upsert']).toBe('false')
    expect(calls[0].headers.Authorization).toBe('Bearer test-session-only')
    expect(calls[0].timeout).toBe(120_000)
    expect(calls[0].body).toBe(original)
    expect(progress).toHaveBeenCalledWith(50)
  })
  it('does not transfer when configuration, identity, ownership or reserved size is invalid', async () => {
    mocks.config.mockReturnValueOnce(null)
    await expect(transferCommunityFile(file(), ticket(), vi.fn())).rejects.toThrow('UPLOAD_NOT_CONFIGURED')
    mocks.session.mockResolvedValueOnce({ data: { session: null }, error: null })
    await expect(transferCommunityFile(file(), ticket(), vi.fn())).rejects.toThrow('SIGN_IN_REQUIRED')
    await expect(transferCommunityFile(file(), { ...ticket(), storageKey: 'someone-else/test.png' }, vi.fn())).rejects.toThrow('INVALID_RESERVATION')
    await expect(transferCommunityFile(file(), { ...ticket(), bytes: 1 }, vi.fn())).rejects.toThrow('INVALID_RESERVATION')
    expect(calls).toHaveLength(0)
  })
  it.each(['error','timeout','reject'] as const)('leaves a failed %s transfer for explicit review without automatic retries', async failure => {
    outcome = failure
    await expect(transferCommunityFile(file(), ticket(), vi.fn())).rejects.toThrow('TRANSFER_FAILED')
    expect(calls).toHaveLength(1)
  })
})
