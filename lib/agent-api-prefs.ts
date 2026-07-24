import { getDefaultAgentModel } from '@/lib/agents/config'
import type { AgentProviderId } from '@/types'

const PREFS_KEY = 'pixel-world-agent-api-prefs'
const KEY_PREFIX = 'pixel-world-agent-api-key:'

export interface AgentApiPrefs {
  provider: AgentProviderId
  model: string
  apiKey: string
}

export function loadAgentApiKey(provider: AgentProviderId): string {
  if (typeof window === 'undefined') return ''
  return sessionStorage.getItem(`${KEY_PREFIX}${provider}`) || ''
}

export function loadAgentApiPrefs(): AgentApiPrefs {
  const fallback: AgentApiPrefs = { provider: 'openrouter', model: getDefaultAgentModel('openrouter'), apiKey: '' }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<AgentApiPrefs>
    const provider: AgentProviderId = parsed.provider === 'openai' || parsed.provider === 'dashscope' ? parsed.provider : 'openrouter'
    const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model : getDefaultAgentModel(provider)
    return { provider, model, apiKey: loadAgentApiKey(provider) }
  } catch {
    return fallback
  }
}

export function saveAgentApiPrefs(prefs: AgentApiPrefs): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(`${KEY_PREFIX}${prefs.provider}`, prefs.apiKey)
  localStorage.setItem(PREFS_KEY, JSON.stringify({ provider: prefs.provider, model: prefs.model }))
}
