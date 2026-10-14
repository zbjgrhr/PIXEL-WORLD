import { describe, expect, it } from 'vitest'
import { formatGenerationError } from './format-generation-error'

describe('paid-provider failures are actionable', () => {
  it('does not call exhausted daily credits a temporary rate limit', () => {
    expect(formatGenerationError('cloudflare 429: used up your daily free allocation of 10,000 neurons')).toContain('今日免费 Neurons 已用完')
  })
  it('explains region restrictions without blaming the key', () => {
    expect(formatGenerationError('Agent API failed (403): This model is not available in your region.')).toContain('当前服务在你所在地区')
  })
  it('identifies the actual OpenAI balance error observed in the trial', () => {
    expect(formatGenerationError('openai 429 credit_balance_exhausted insufficient_quota')).toContain('账户额度不足')
  })
})
