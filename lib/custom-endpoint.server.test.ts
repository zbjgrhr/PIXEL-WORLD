import { describe, expect, it } from 'vitest'
import { validateCustomBaseUrl } from './custom-endpoint.server'

describe('custom AI endpoint boundary', () => {
  it('accepts only public-looking HTTPS API roots and removes trailing slashes', () => {
    expect(validateCustomBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1')
    expect(validateCustomBaseUrl('https://api.example.com:443/v1')).toBe('https://api.example.com/v1')
  })

  it.each([
    'http://api.example.com/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://localhost/v1',
    'https://user:pass@api.example.com/v1',
    'https://api.example.com:8443/v1',
    'https://api.example.com/v1?next=http://127.0.0.1',
    'https://api.example.com/v1#fragment',
  ])('rejects unsafe interface address %s', (address) => {
    expect(() => validateCustomBaseUrl(address)).toThrow()
  })
})
