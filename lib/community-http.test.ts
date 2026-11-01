import { describe, expect, it } from 'vitest'
import { communitySameOrigin } from './community-http'

describe('browser origin against the actual request host', () => {
  const request = (origin: string, host?: string, url = 'http://localhost:3005/api/community/posts') => new Request(url, { headers: { Origin: origin, ...(host ? { Host: host } : {}) } })
  it('accepts matching origins and a browser-facing loopback host when Next uses an internal alias', () => {
    expect(communitySameOrigin(request('http://localhost:3005'))).toBe(true)
    expect(communitySameOrigin(request('http://127.0.0.1:3005','127.0.0.1:3005'))).toBe(true)
    expect(communitySameOrigin(request('https://pixel.example','pixel.example','https://internal.example/api'))).toBe(true)
  })
  it('rejects cross-site, wrong-port, missing, malformed and protocol-mismatched origins', () => {
    for (const origin of ['null','http://other.example','http://localhost:3004','https://localhost:3005','http://localhost:3005/','http://user@localhost:3005','http://localhost:3005#fragment','http://localhost:3005 http://other.example']) expect(communitySameOrigin(request(origin))).toBe(false)
    expect(communitySameOrigin(new Request('http://localhost:3005/api'))).toBe(false)
    expect(communitySameOrigin(request('http://localhost:3005','other.example'))).toBe(false)
  })
  it('does not trust forwarded hosts or malformed Host headers', () => {
    const forwarded = new Request('http://localhost:3005/api', { headers: { Origin: 'http://other.example', Host: 'localhost:3005', 'x-forwarded-host': 'other.example' } })
    expect(communitySameOrigin(forwarded)).toBe(false)
    for (const host of ['localhost:3005,other.example','user@localhost:3005','localhost:3005/path']) expect(communitySameOrigin(request('http://localhost:3005',host))).toBe(false)
  })
})
