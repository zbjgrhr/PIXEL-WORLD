const UNICODE_DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g
const INVISIBLE_CHARACTERS = /[\u200B-\u200D\u2060\uFEFF]/g
const NON_HEADER_ASCII = /[^\x21-\x7E]/

/**
 * API keys are copied from dashboards surprisingly often with a typographic
 * dash or an invisible formatting character. Header values only accept
 * ByteString data, so normalise those copy/paste artefacts before a request is
 * made. Deliberately do not remove ordinary characters from the middle of a
 * key: malformed pasted text should be rejected rather than sent upstream.
 */
export function normalizeApiKey(value: string | undefined): string {
  return (value || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(UNICODE_DASHES, '-')
    .replace(INVISIBLE_CHARACTERS, '')
    .trim()
}

export function apiKeyHasUnsupportedCharacters(value: string | undefined): boolean {
  const key = normalizeApiKey(value)
  return Boolean(key) && NON_HEADER_ASCII.test(key)
}

