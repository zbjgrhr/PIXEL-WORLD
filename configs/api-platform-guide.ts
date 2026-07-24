export type ApiPlatformId =
  | 'openrouter'
  | 'openai'
  | 'dashscope'
  | 'cloudflare'
  | 'together'
  | 'tencent'
  | 'pollinations'
  | 'huggingface'

export interface ApiPlatformGuide {
  id: ApiPlatformId
  name: string
  company: string
  modes: Array<'agent' | 'image'>
  accent: string
  soft: string
  slogan: string
  strengths: string[]
  costLabel: string
  keyFormat: string
  steps: string[]
  setupUrl: string
  docsUrl: string
  caution: string
}

/** Safe, user-facing platform documentation. No credentials are stored here. */
export const API_PLATFORM_GUIDES: ApiPlatformGuide[] = [
  {
    id: 'openrouter', name: 'OpenRouter', company: '聚合模型平台', modes: ['agent', 'image'],
    accent: '#7557e8', soft: '#f1edff',
    slogan: '一个 Key 切换多家公司模型，适合快速比较效果。',
    strengths: ['多模型聚合', 'Agent 选择丰富', '统一账单', '可设消费上限'],
    costLabel: '按所选模型计费', keyFormat: 'sk-or-v1-…',
    steps: ['打开 Keys 页面并创建 Key', '建议为 Key 设置额度上限', '在网页选择 OpenRouter 与模型后粘贴 Key'],
    setupUrl: 'https://openrouter.ai/settings/keys', docsUrl: 'https://openrouter.ai/docs/quickstart',
    caution: '免费文字模型与付费图片模型的额度不同；选择模型前请查看模型价格。',
  },
  {
    id: 'openai', name: 'OpenAI', company: 'OpenAI 官方接口', modes: ['agent', 'image'],
    accent: '#18a572', soft: '#eafaf4',
    slogan: '指令遵循与结构化输出稳定，适合完整 GameSpec 规划。',
    strengths: ['结构化输出', '指令稳定', 'GPT Image', '视觉理解'],
    costLabel: '按量付费', keyFormat: 'sk-proj-… / sk-…',
    steps: ['在 Platform 创建项目 API Key', '确认账户已有可用额度', '选择 OpenAI 与目标模型后粘贴 Key'],
    setupUrl: 'https://platform.openai.com/api-keys', docsUrl: 'https://developers.openai.com/api/docs/guides/image-generation',
    caution: '建议使用项目级 Key，并在平台侧设置预算与用量提醒。',
  },
  {
    id: 'dashscope', name: 'Alibaba DashScope', company: '阿里云百炼', modes: ['agent', 'image'],
    accent: '#2878ff', soft: '#eaf2ff',
    slogan: '中文理解优秀，文字 Agent 与 Qwen 图片可共用百炼 Key。',
    strengths: ['中文提示词', 'Qwen 系列', '国内访问', '文字图片共用 Key'],
    costLabel: '按模型计费', keyFormat: 'sk-… / sk-ws-…',
    steps: ['进入百炼控制台创建 API Key', '确认 Key 所属地域和业务空间', '选择 DashScope 与模型后粘贴 Key'],
    setupUrl: 'https://bailian.console.aliyun.com/', docsUrl: 'https://help.aliyun.com/zh/model-studio/get-api-key/',
    caution: 'API Key 与调用地域必须一致；北京、新加坡等地域的 Key 不可混用。',
  },
  {
    id: 'cloudflare', name: 'Cloudflare Workers AI', company: 'Cloudflare', modes: ['image'],
    accent: '#f48120', soft: '#fff3e8',
    slogan: '轻量、快速，适合低成本迭代像素素材与动作参考图。',
    strengths: ['低成本尝试', 'FLUX 系列', '边缘网络', '参考图支持'],
    costLabel: '含免费配额可能性', keyFormat: 'ACCOUNT_ID|API_TOKEN',
    steps: ['在 Workers AI 页面复制 Account ID', '创建 Workers AI API Token', '按 Account ID|API Token 的格式粘贴'],
    setupUrl: 'https://dash.cloudflare.com/profile/api-tokens', docsUrl: 'https://developers.cloudflare.com/workers-ai/get-started/rest-api/',
    caution: '中间必须使用英文竖线“|”；只填 Token 会鉴权失败。实际额度以账户页面为准。',
  },
  {
    id: 'together', name: 'Together AI', company: '开源模型推理平台', modes: ['image'],
    accent: '#9a5be8', soft: '#f7eeff',
    slogan: 'FLUX 型号丰富，兼顾快速草图与高质量参考图生成。',
    strengths: ['FLUX 丰富', '速度快', '项目级 Key', '参考图工作流'],
    costLabel: '从低价到高质量', keyFormat: 'Together Project API Key',
    steps: ['注册后进入 Project 的 API Keys', '创建并立即保存新 Key', '选择 Together AI 与 FLUX 模型后粘贴'],
    setupUrl: 'https://api.together.ai/settings/api-keys', docsUrl: 'https://docs.together.ai/docs/inference/images/overview',
    caution: 'Key 归属于具体 Project；Free 型号是否可用取决于当前账户权限。',
  },
  {
    id: 'tencent', name: 'Tencent TokenHub', company: '腾讯云大模型服务平台', modes: ['image'],
    accent: '#11a8c7', soft: '#e9faff',
    slogan: '混元生图擅长复杂中文描述与东方场景，适合中文创作。',
    strengths: ['中文语义', '混元生图', '游戏场景', '国内平台'],
    costLabel: '体验额度＋按量计费', keyFormat: 'TokenHub API Key',
    steps: ['开通腾讯云 TokenHub 服务', '在 API Key 管理页创建 Key', '选择 Tencent TokenHub 与混元模型后粘贴'],
    setupUrl: 'https://console.cloud.tencent.com/tokenhub', docsUrl: 'https://cloud.tencent.com/document/product/1823/130080',
    caution: '这里使用 TokenHub API Key，不是传统腾讯云 SecretId / SecretKey。',
  },
  {
    id: 'pollinations', name: 'Pollinations', company: '开放式生成平台', modes: ['image'],
    accent: '#ed5da8', soft: '#fff0f7',
    slogan: '接入门槛低、模型选择灵活，适合原型和快速视觉实验。',
    strengths: ['快速原型', '多图片模型', '模型限制 Key', '额度可控'],
    costLabel: 'Pollen 额度制', keyFormat: 'pk_… / sk_…',
    steps: ['登录 Enter Pollinations', '创建并限制模型/预算的 Key', '选择 Pollinations 与当前可用模型后粘贴'],
    setupUrl: 'https://enter.pollinations.ai/', docsUrl: 'https://github.com/pollinations/pollinations/blob/main/APIDOCS.md',
    caution: '模型供应和额度可能变化；批量生图前务必先点击“测试 API”。',
  },
  {
    id: 'huggingface', name: 'Hugging Face Inference', company: '开源模型社区与推理服务', modes: ['image'],
    accent: '#d99400', soft: '#fff8df',
    slogan: '适合探索开源图片模型，方便比较 FLUX、SDXL 等路线。',
    strengths: ['开源模型', '模型实验', 'FLUX / SDXL', '细粒度 Token'],
    costLabel: '额度与供应商相关', keyFormat: 'hf_…',
    steps: ['进入 Settings → Tokens', '创建带 Inference Providers 权限的 Token', '选择 Hugging Face 与模型后粘贴 Token'],
    setupUrl: 'https://huggingface.co/settings/tokens', docsUrl: 'https://huggingface.co/docs/inference-providers/en/index',
    caution: '必须启用推理权限；模型是否在线和免费额度由当前账户与供应商决定。',
  },
]

export function getApiPlatformGuide(id: string): ApiPlatformGuide {
  return API_PLATFORM_GUIDES.find((item) => item.id === id) || API_PLATFORM_GUIDES[0]
}

export function getApiPlatformsForMode(mode: 'agent' | 'image'): ApiPlatformGuide[] {
  return API_PLATFORM_GUIDES.filter((item) => item.modes.includes(mode))
}
