import { EventEmitter } from 'node:events'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { customChatStream, customJsonRequest, validateCustomBaseUrl } from './custom-endpoint.server'

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }))
vi.mock('node:https', () => ({ request: vi.fn() }))
beforeEach(() => vi.resetAllMocks())

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

  it.each([false, true])('pins the validated public address with DNS all=%s', async all => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    const callback = vi.fn()
    vi.mocked(request).mockImplementation(((url: URL, options: RequestOptions, response: (value: IncomingMessage) => void) => {
      expect(url.pathname).toBe('/v1/chat/completions')
      options.lookup!(url.hostname, { all }, callback)
      const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' } })
      return Object.assign(new EventEmitter(), {
        write: vi.fn(),
        end: () => queueMicrotask(() => {
          response(incoming as IncomingMessage)
          incoming.emit('data', Buffer.from('{"choices":[]}'))
          incoming.emit('end')
        }),
      })
    }) as unknown as typeof request)
    await expect(customJsonRequest('https://api.example.com/v1', '/chat/completions', 'test-key', { model: 'test' })).resolves.toEqual({ choices: [] })
    if (all) expect(callback).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }])
    else expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
  })

  it('does not send credentials when DNS includes a private address', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] as never)
    await expect(customJsonRequest('https://api.example.com/v1', '/chat/completions', 'test-key', {})).rejects.toThrow('公开 IPv4')
    expect(request).not.toHaveBeenCalled()
  })

  it.each([true, false])('assembles a streamed chat response only when complete (complete=%s)', async complete => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never)
    const events = [
      'data: {"choices":[{"delta":{"content":"{\\"summary\\":"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"\\"完成\\"}"},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":22,"completion_tokens":5}}\n\n',
      ...(complete ? ['data: [DONE]\n\n'] : []),
    ]
    vi.mocked(request).mockImplementation(((_url: URL, options: RequestOptions, response: (value: IncomingMessage) => void) => {
      expect(options.headers).toMatchObject({ Authorization: 'Bearer test-key' })
      const incoming = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'text/event-stream' } })
      let sent = ''
      return Object.assign(new EventEmitter(), {
        write: (chunk: string) => { sent += chunk },
        end: () => queueMicrotask(() => {
          expect(JSON.parse(sent)).toMatchObject({ stream: true, stream_options: { include_usage: true }, model: 'test' })
          response(incoming as IncomingMessage)
          const data = events.join('')
          incoming.emit('data', Buffer.from(data.slice(0, 25)))
          incoming.emit('data', Buffer.from(data.slice(25)))
          incoming.emit('end')
        }),
      })
    }) as unknown as typeof request)
    const call = customChatStream('https://api.example.com/v1', 'test-key', { model: 'test' })
    if (complete) await expect(call).resolves.toMatchObject({ choices: [{ finish_reason: 'stop', message: { content: '{"summary":"完成"}' } }], usage: { prompt_tokens: 22, completion_tokens: 5 } })
    else await expect(call).rejects.toThrow('未完整结束')
  })
})
