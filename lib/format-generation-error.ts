/** Turn raw upstream / API error strings into user-facing messages. */
export function formatGenerationError(raw: string): string {
  const lower = raw.toLowerCase()

  if (lower.includes('billing_hard_limit') || lower.includes('billing hard limit')) {
    return 'OpenAI 账户已达消费硬上限。请到 platform.openai.com → Billing 绑定支付方式并提高 Hard limit，然后重试。'
  }

  if (lower.includes('insufficient_quota') || lower.includes('exceeded your current quota')) {
    return 'OpenAI 账户额度不足。请到 Billing 充值或检查套餐配额。'
  }

  if (lower.includes('invalid_api_key') || lower.includes('invalid api-key') || lower.includes('incorrect api key')) {
    if (raw.includes('[Interve') || raw.startsWith('[')) {
      return 'API Key 格式无效：输入框里可能混入了浏览器控制台文字。请清空后只粘贴以 sk- 开头的 OpenAI Key。'
    }
    return 'API Key 无效。请确认 Provider 与 Key 匹配（OpenAI 用 sk- 开头，DashScope 用百炼 Key），并重新粘贴。'
  }

  if (lower.includes("does not exist") && lower.includes('model')) {
    return '所选模型已停用或不可用。请刷新页面后选择 GPT Image 2 / 1.5 / 1 Mini，并重新部署最新版本。'
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'API 请求频率过高，请稍后再试。'
  }

  if (lower.includes('organization') && lower.includes('verify')) {
    return 'OpenAI 账户需完成 Organization Verification 才能使用 GPT Image 模型。'
  }

  return raw
}

export function mapUpstreamHttpStatus(upstreamStatus: number, detail: string): number {
  if (upstreamStatus === 429) return 429

  const lower = detail.toLowerCase()
  if (
    upstreamStatus === 401 ||
    lower.includes('invalid_api_key') ||
    lower.includes('invalid api-key')
  ) {
    return 401
  }

  if (
    upstreamStatus === 400 ||
    lower.includes('billing_hard_limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('does not exist')
  ) {
    return 400
  }

  if (upstreamStatus >= 400 && upstreamStatus < 500) return 400
  return 502
}
