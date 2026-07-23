/** Turn raw upstream / API error strings into user-facing messages. */
export function formatGenerationError(raw: string): string {
  const lower = raw.toLowerCase()

  if (lower.includes('bytestring') || lower.includes('greater than 255')) {
    return 'API Key 中混入了中文符号、长破折号或隐藏字符。请清空输入框，并从平台控制台重新复制纯 API Key。'
  }

  if (
    lower.includes('openrouter') &&
    (lower.includes('402') ||
      lower.includes('insufficient credits') ||
      lower.includes('insufficient balance') ||
      lower.includes('payment required'))
  ) {
    return 'OpenRouter 余额不足。当前所选图片模型按量计费，请先在 openrouter.ai 充值后重试；程序不会隐藏切换到其他模型。'
  }

  if (lower.includes('cloudflare') && lower.includes('account id|api token')) {
    return 'Cloudflare 凭据格式不正确。请在一个输入框中粘贴“Account ID|API Token”，中间使用英文竖线 |。'
  }

  if (lower.includes('gated') || lower.includes('accept the conditions')) {
    return '该 Hugging Face 模型需要先在模型页面接受许可条款，然后才能通过 API 调用。'
  }

  if (lower.includes('huggingface') && (lower.includes('permission') || lower.includes('403'))) {
    return 'Hugging Face Token 没有推理权限，或当前免费额度无法使用该模型。请给 Token 勾选“Make calls to Inference Providers”。'
  }

  if (lower.includes('together') && lower.includes('model') && lower.includes('not')) {
    return '当前 Together AI 账户无法使用这个图片模型。请换用同平台可用模型，并先运行“测试 API”。'
  }

  if (lower.includes('pollinations') && (lower.includes('paid_only') || lower.includes('permission'))) {
    return '当前 Pollinations Key 没有该图片模型的权限或余额，请先在 Pollinations 控制台确认可用模型。'
  }

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
    return 'API Key 无效。请确认当前选择的平台与 Key 匹配，并从该平台控制台重新复制。'
  }

  if (lower.includes("does not exist") && lower.includes('model')) {
    if (lower.includes('openrouter')) {
      return '所选 OpenRouter 图片模型已停用或暂不可用。请刷新页面并选择 Seedream 4.5 或 FLUX.2 Pro。'
    }
    return '所选模型已停用或不可用。请刷新页面后重新选择当前可用模型。'
  }

  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'API 请求频率过高，请稍后再试。'
  }

  if (lower.includes('http 413') || lower.includes('payload too large') || lower.includes('request entity too large')) {
    return '请求数据过大（HTTP 413）。程序会在重试时自动移除已生成图片数据；请刷新到最新版后再次生成该素材。'
  }

  if (
    lower.includes('protected content')
    || lower.includes('request moderated')
    || lower.includes('content policy')
    || lower.includes('content_policy')
  ) {
    return '图片服务认为该素材提示词可能涉及受保护内容。程序已用原创、中性、单素材提示词自动重试；如果仍失败，请删除现有作品、角色、品牌或艺术家名称后重试。'
  }

  if (lower.includes('organization') && lower.includes('verify')) {
    return 'OpenAI 账户需完成 Organization Verification 才能使用 GPT Image 模型。'
  }

  return raw
}

export function mapUpstreamHttpStatus(upstreamStatus: number, detail: string): number {
  if (upstreamStatus === 429) return 429
  if (upstreamStatus === 413) return 413

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
