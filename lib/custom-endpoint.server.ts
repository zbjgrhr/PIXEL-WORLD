import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import sharp from 'sharp'

const MAX_JSON_BYTES = 32 * 1024 * 1024
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export class CustomEndpointError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

function publicIpv4(ip: string): boolean {
  if (isIP(ip) !== 4) return false
  const [a, b, c] = ip.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) return false
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function parsePublicHttps(value: string, allowQuery = false): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new CustomEndpointError(400, '接口地址不是有效网址。') }
  if (url.protocol !== 'https:' || url.port && url.port !== '443' || !url.hostname.includes('.') || isIP(url.hostname)
    || url.username || url.password || url.hash || (!allowQuery && url.search) || url.hostname.endsWith('.local')) {
    throw new CustomEndpointError(400, '手动接入只接受公开 HTTPS 地址，不接受本机、内网、账号信息或跳转地址。')
  }
  return url
}

export function validateCustomBaseUrl(value: string): string {
  const url = parsePublicHttps(value.trim())
  const path = url.pathname.replace(/\/+$/, '')
  if (path.includes('/../') || path.length > 300) throw new CustomEndpointError(400, '接口地址路径无效。')
  return `${url.origin}${path}`
}

async function requestPublicHttps(url: URL, body?: string, apiKey?: string, maxBytes = MAX_JSON_BYTES, timeoutMs = 45000): Promise<{ status: number; contentType: string; bytes: Buffer }> {
  const addresses = await lookup(url.hostname, { family: 4, all: true }).catch(() => [])
  if (!addresses.length || addresses.some((item) => !publicIpv4(item.address))) throw new CustomEndpointError(400, '接口域名没有可用的公开 IPv4 地址。')
  const pinnedAddress = addresses[0].address
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: body === undefined ? 'GET' : 'POST',
      lookup: (_host, _options, callback) => callback(null, pinnedAddress, 4),
      timeout: timeoutMs,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    }, (response) => {
      const status = response.statusCode || 502
      if (status >= 300 && status < 400) {
        response.resume()
        reject(new CustomEndpointError(400, '接口返回跳转；请填写最终的 HTTPS 接口地址。'))
        return
      }
      const chunks: Buffer[] = []
      let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > maxBytes) {
          response.destroy(new CustomEndpointError(502, '接口响应过大，已停止读取。'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolve({ status, contentType: String(response.headers['content-type'] || ''), bytes: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new CustomEndpointError(504, '接口响应超时。')))
    req.on('error', (error) => reject(error instanceof CustomEndpointError ? error : new CustomEndpointError(502, '无法连接自定义接口，请核对地址或服务状态。')))
    if (body !== undefined) req.write(body)
    req.end()
  })
}

export async function customJsonRequest(baseUrl: string, suffix: '/chat/completions' | '/images/generations', apiKey: string, payload: unknown): Promise<Record<string, unknown>> {
  const endpoint = parsePublicHttps(`${validateCustomBaseUrl(baseUrl)}${suffix}`)
  const body = JSON.stringify(payload)
  if (Buffer.byteLength(body) > 1024 * 1024) throw new CustomEndpointError(400, '发送给模型的内容过大。')
  const response = await requestPublicHttps(endpoint, body, apiKey, suffix === '/images/generations' ? 28 * 1024 * 1024 : 2 * 1024 * 1024)
  if (response.status < 200 || response.status >= 300) {
    const reason = response.status === 401 || response.status === 403 ? '认证失败，请检查 API Key 和模型权限。'
      : response.status === 404 ? '接口路径不存在，请检查 API 根地址是否正确。'
        : response.status === 400 || response.status === 422 ? '请求被拒绝，请检查模型 ID 与 OpenAI 风格接口兼容性。'
          : response.status === 429 ? '调用频率或额度已达到服务商限制。'
            : '服务商未成功返回结果，请检查其服务状态。'
    throw new CustomEndpointError(response.status, `自定义接口调用失败（HTTP ${response.status}）：${reason}`)
  }
  try {
    const value = JSON.parse(response.bytes.toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object')
    return value as Record<string, unknown>
  } catch { throw new CustomEndpointError(502, '接口没有返回兼容的 JSON 数据。') }
}

async function imageDataUrl(bytes: Buffer): Promise<string> {
  if (bytes.length < 1024 || bytes.length > MAX_IMAGE_BYTES) throw new CustomEndpointError(502, '接口返回的图片大小不合理。')
  const metadata = await sharp(bytes).metadata().catch(() => null)
  if (!metadata?.width || !metadata.height || metadata.width < 64 || metadata.height < 64 || metadata.width > 4096 || metadata.height > 4096) {
    throw new CustomEndpointError(502, '接口没有返回可用的图片。')
  }
  const mime = metadata.format === 'jpeg' ? 'image/jpeg' : metadata.format === 'webp' ? 'image/webp' : metadata.format === 'png' ? 'image/png' : ''
  if (!mime) throw new CustomEndpointError(502, '接口图片格式需为 PNG、JPEG 或 WebP。')
  return `data:${mime};base64,${bytes.toString('base64')}`
}

export async function customImageResult(baseUrl: string, apiKey: string, payload: unknown): Promise<string> {
  const result = await customJsonRequest(baseUrl, '/images/generations', apiKey, payload)
  const data = Array.isArray(result.data) ? result.data[0] as { b64_json?: unknown; url?: unknown } | undefined : undefined
  if (typeof data?.b64_json === 'string') return imageDataUrl(Buffer.from(data.b64_json, 'base64'))
  if (typeof data?.url === 'string') {
    const response = await requestPublicHttps(parsePublicHttps(data.url, true), undefined, undefined, MAX_IMAGE_BYTES)
    if (response.status < 200 || response.status >= 300 || !response.contentType.toLowerCase().startsWith('image/')) {
      throw new CustomEndpointError(502, '接口返回的图片链接无法安全读取。')
    }
    return imageDataUrl(response.bytes)
  }
  throw new CustomEndpointError(502, '图片接口需返回 data[0].b64_json 或 data[0].url。')
}
