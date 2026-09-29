export interface CustomConnection {
  displayName: string
  baseUrl: string
  model: string
  apiKey: string
}

export type AiAccessMode = 'ready' | 'own'
export type AiArea = 'agent' | 'image'

export const EMPTY_CUSTOM_CONNECTION: CustomConnection = { displayName: '', baseUrl: '', model: '', apiKey: '' }

const prefix = (area: AiArea) => `pixel-world-${area}-custom-connection`

export function loadCustomConnection(area: AiArea): CustomConnection {
  if (typeof window === 'undefined') return { ...EMPTY_CUSTOM_CONNECTION }
  try {
    const saved = JSON.parse(localStorage.getItem(prefix(area)) || '{}') as Partial<CustomConnection>
    return {
      displayName: typeof saved.displayName === 'string' ? saved.displayName : '',
      baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
      model: typeof saved.model === 'string' ? saved.model : '',
      apiKey: sessionStorage.getItem(`${prefix(area)}-key`) || '',
    }
  } catch { return { ...EMPTY_CUSTOM_CONNECTION } }
}

export function saveCustomConnection(area: AiArea, value: CustomConnection): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(prefix(area), JSON.stringify({ displayName: value.displayName, baseUrl: value.baseUrl, model: value.model }))
  sessionStorage.setItem(`${prefix(area)}-key`, value.apiKey)
}

export function loadAiAccessMode(area: AiArea): AiAccessMode {
  if (typeof window === 'undefined') return 'ready'
  const saved = localStorage.getItem(`pixel-world-${area}-access-mode`)
  if (saved === 'ready' || saved === 'own') return saved
  // Preserve legacy BYOK selections after an upgrade, while new visitors start with ready options.
  if (area === 'image' && localStorage.getItem('pixel-seed-image-api-prefs')) return 'own'
  if (area === 'agent' && localStorage.getItem('pixel-world-agent-api-prefs')) return 'own'
  if (area === 'agent' && localStorage.getItem('pixel-local-provider')) return 'ready'
  return 'ready'
}

export function saveAiAccessMode(area: AiArea, mode: AiAccessMode): void {
  if (typeof window !== 'undefined') localStorage.setItem(`pixel-world-${area}-access-mode`, mode)
}

export function customConnectionError(value: CustomConnection): string | null {
  if (!value.baseUrl.trim()) return '请填写接口地址。仅填写名称和 API Key 无法连接。'
  if (!value.model.trim()) return '请填写模型 ID。仅填写名称和 API Key 无法连接。'
  if (!value.apiKey.trim()) return '请填写该服务商的 API Key。'
  try {
    const url = new URL(value.baseUrl)
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || url.search || url.hash) throw new Error('invalid')
  } catch { return '接口地址需要是公开的 HTTPS API 根地址，例如 https://example.com/v1。' }
  return null
}
