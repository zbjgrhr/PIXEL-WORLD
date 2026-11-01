export const communityResponseHeaders = { 'Cache-Control': 'private, no-store' }
/** Next's internal URL can use localhost while the browser requested 127.0.0.1.
 * Compare Origin with the actual Host header, never an untrusted forwarded host.
 * Missing Origin, credentials, paths, multiple origins and protocol changes fail.
 */
export function communitySameOrigin(request: Request): boolean {
  try {
    const origin = request.headers.get('origin')
    if (!origin) return false
    const requested = new URL(request.url), parsed = new URL(origin)
    if (!['http:','https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.protocol !== requested.protocol) return false
    const host = request.headers.get('host') || requested.host
    if (!/^[a-z\d.:[\]-]+$/i.test(host)) return false
    const actual = new URL(`${requested.protocol}//${host}`)
    return parsed.origin === actual.origin
  } catch { return false }
}
export const communityPostColumns = 'id,owner_id,section,language,title,description,experiment_id,rights,license_note,reuse,moderation,created_at,updated_at,art_kind,linked_game_id'

/** Bound the actual streamed bytes, including requests without Content-Length. */
export async function readCommunityJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('invalid-body')
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 64_000) { await reader.cancel(); throw new Error('body-too-large') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder().decode(bytes))
}
