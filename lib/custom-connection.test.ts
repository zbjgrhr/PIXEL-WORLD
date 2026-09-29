import { describe, expect, it } from 'vitest'
import { customConnectionError } from './custom-connection'

describe('manual AI connection form', () => {
  it('explains why a display name and key alone cannot connect', () => {
    expect(customConnectionError({ displayName: 'My AI', baseUrl: '', model: '', apiKey: 'test-key' })).toContain('接口地址')
    expect(customConnectionError({ displayName: 'My AI', baseUrl: 'https://api.example.com/v1', model: '', apiKey: 'test-key' })).toContain('模型 ID')
  })
})
