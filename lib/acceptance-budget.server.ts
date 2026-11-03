import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

// Opt-in local acceptance harness. Ordinary deployments do not enable this.
interface Ledger {
  code: string
  textModel: string
  imageModel: string
  textCeilingUsd: number
  imageCeilingUsd: number
  maxImageRequestsIncludingFailures: number
  calls?: Array<{ id: string; kind: 'text' | 'image'; reservedUsd: number; chargedUpperUsd: number; status: string; model: string; usage?: unknown }>
}

export function acceptanceReservation(body: Record<string, unknown>, image: boolean, textModel: string): number {
  if (image) return 0.04
  const rates = textModel === 'openai/gpt-4.1-mini' ? [0.4, 1.6] : textModel === 'anthropic/claude-sonnet-5.5' ? [2, 10] : undefined
  if (!rates) throw new Error('Acceptance budget: unapproved text model')
  // One UTF-8 byte per input token is a conservative upper bound; image
  // tokens cannot be bounded this way, so this harness refuses vision input.
  if (JSON.stringify(body.messages).includes('image_url')) throw new Error('Acceptance budget: vision input not budgeted')
  const output = Number(body.max_tokens)
  if (!Number.isFinite(output) || output <= 0) throw new Error('Acceptance budget: missing output ceiling')
  return ((Buffer.byteLength(JSON.stringify(body.messages || []), 'utf8') + 2048) * rates[0] + output * rates[1]) / 1_000_000
}

export async function acceptanceFetch(url: string, init: RequestInit): Promise<Response> {
  const ledgerPath = process.env.PIXEL_WORLD_ACCEPTANCE_LEDGER
  if (!ledgerPath) return fetch(url, init)
  if (url !== 'https://openrouter.ai/api/v1/chat/completions' && url !== 'https://openrouter.ai/api/v1/images') throw new Error('Acceptance budget: unapproved endpoint')
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8').replace(/^\uFEFF/, '')) as Ledger
  const body = JSON.parse(String(init.body)) as Record<string, unknown>
  const image = url.endsWith('/images')
  if (body.model !== (image ? ledger.imageModel : ledger.textModel)) throw new Error('Acceptance budget: model differs from approved run')
  if (image && Number(body.n || 1) !== 1) throw new Error('Acceptance budget: only one image per request')
  // Pin routing and cap billed token prices, including reasoning output.
  body.provider = { sort: 'price', allow_fallbacks: false, ...(image ? {} : { max_price: ledger.textModel === 'openai/gpt-4.1-mini' ? { prompt: 0.4, completion: 1.6 } : { prompt: 2, completion: 10 } }) }
  if (!image && ledger.textModel === 'anthropic/claude-sonnet-5.5') body.reasoning = { effort: 'low' }
  const reservedUsd = acceptanceReservation(body, image, ledger.textModel)
  const kind = image ? 'image' : 'text'
  const calls = ledger.calls || []
  const spent = calls.filter(call => call.kind === kind).reduce((sum, call) => sum + call.chargedUpperUsd, 0)
  if ((image && calls.filter(call => call.kind === 'image').length >= ledger.maxImageRequestsIncludingFailures) || spent + reservedUsd > (image ? ledger.imageCeilingUsd : ledger.textCeilingUsd) + 1e-9) throw new Error(`Acceptance budget: ${ledger.code} ${kind} ceiling reached; no request sent`)
  const id = randomUUID()
  calls.push({ id, kind, reservedUsd, chargedUpperUsd: reservedUsd, status: 'reserved', model: String(body.model) })
  ledger.calls = calls
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2))
  const finish = (status: string, usage?: Record<string, unknown>) => {
    const latest = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger
    const call = latest.calls?.find(item => item.id === id)
    if (!call) throw new Error('Acceptance budget: reservation lost')
    call.status = status
    call.usage = usage
    if (!image && usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens)) {
      const rates = ledger.textModel === 'openai/gpt-4.1-mini' ? [0.4, 1.6] : [2, 10]
      const upper = (Number(usage.prompt_tokens) * rates[0] + Number(usage.completion_tokens) * rates[1]) / 1_000_000
      call.chargedUpperUsd = Math.max(upper, typeof usage.cost === 'number' ? usage.cost : 0)
    }
    writeFileSync(ledgerPath, JSON.stringify(latest, null, 2))
  }
  try {
    const response = await fetch(url, { ...init, body: JSON.stringify(body) })
    const result = await response.clone().json().catch(() => undefined)
    finish(`http-${response.status}`, result?.usage)
    return response
  } catch (error) {
    finish('failed-reservation-retained')
    throw error
  }
}
