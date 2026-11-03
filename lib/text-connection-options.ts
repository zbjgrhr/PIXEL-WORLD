import type { ConnectionChoiceGroup } from '@/components/ui/ConnectionChoiceGroups'

export const READY_TEXT_GROUPS: ConnectionChoiceGroup[] = [
  { tone: 'green', title: '无需配置', description: '直接整理故事，不调用 AI。', choices: [{ id: 'builtin', name: '内置规则整理', note: '无需 Key · 无需下载' }] },
  { tone: 'purple', title: '本机 · 命令行工具', description: '先安装工具、下载模型，再启动本机服务。', choices: [{ id: 'ollama', name: 'Ollama', note: '命令行管理模型' }] },
  { tone: 'teal', title: '本机 · 图形界面工具', description: '在桌面软件中下载并加载模型，开启本地 API。', choices: [{ id: 'lmstudio', name: 'LM Studio', note: '桌面应用' }, { id: 'gpt4all', tone: 'orange', name: 'GPT4All', note: '桌面应用' }, { id: 'jan', tone: 'rose', name: 'Jan', note: '桌面应用' }] },
  { tone: 'blue', title: '浏览器运行', description: '无需桌面软件；首次下载模型，需要 WebGPU。', choices: [{ id: 'webllm', name: 'WebLLM', note: '当前浏览器运行' }] },
]

interface TextConnectionPreset {
  id: string; name: string; baseUrl: string; docsUrl: string
  kind: 'platform' | 'vendor'
  tone: ConnectionChoiceGroup['tone']
  note: string
  hint?: string
}

export const TEXT_CONNECTION_PRESETS: TextConnectionPreset[] = [
  { id: 'preset-deepseek', kind: 'vendor', tone: 'blue', name: 'DeepSeek', note: 'DeepSeek 官方 API', baseUrl: 'https://api.deepseek.com', docsUrl: 'https://api-docs.deepseek.com/quick_start/agent_integrations/' },
  { id: 'preset-siliconflow', kind: 'platform', tone: 'orange', name: '硅基流动 SiliconFlow', note: '多厂商模型推理平台', baseUrl: 'https://api.siliconflow.cn/v1', docsUrl: 'https://api-docs.siliconflow.cn/docs/userguide/quickstart' },
  { id: 'preset-kimi', kind: 'vendor', tone: 'blue', name: 'Kimi 月之暗面', note: 'Kimi · 中国站 API', baseUrl: 'https://api.moonshot.cn/v1', docsUrl: 'https://platform.kimi.com/docs/get-api-key', hint: '此处预填中国站地址。其他区域账号请按自己的官方控制台文档修改地址；Key 与区域需匹配。' },
  { id: 'preset-zhipu', kind: 'vendor', tone: 'teal', name: '智谱 GLM', note: '智谱开放平台 API', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', docsUrl: 'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction', hint: '此处为通用按量 API 地址，不会自动使用 Coding Plan 订阅额度。' },
  { id: 'preset-minimax', kind: 'vendor', tone: 'rose', name: 'MiniMax', note: 'MiniMax · 国际站 API', baseUrl: 'https://api.minimax.io/v1', docsUrl: 'https://platform.minimax.io/docs/api-reference/text-openai-api', hint: '此处为国际站通用 API 地址，需对应平台的 Key；订阅计划或其他区域地址请以官方控制台为准。' },
  { id: 'preset-ark', kind: 'vendor', tone: 'orange', name: '火山方舟 / 豆包 Doubao', note: '豆包等模型 · 北京区域 API', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', docsUrl: 'https://docs.volcengine.com/docs/ark/quick-start?lang=zh', hint: '按控制台填写可调用模型或推理接入点 ID。此通用 API 不会自动使用 Coding Plan 订阅额度。' },
  { id: 'preset-groq', kind: 'platform', tone: 'orange', name: 'Groq', note: '多模型云端推理', baseUrl: 'https://api.groq.com/openai/v1', docsUrl: 'https://console.groq.com/docs/openai' },
  { id: 'preset-together', kind: 'platform', tone: 'purple', name: 'Together AI', note: '多厂商模型托管与推理', baseUrl: 'https://api.together.ai/v1', docsUrl: 'https://docs.together.ai/docs/inference/openai-compatibility' },
  { id: 'preset-mistral', kind: 'vendor', tone: 'orange', name: 'Mistral AI', note: 'Mistral 官方 API', baseUrl: 'https://api.mistral.ai/v1', docsUrl: 'https://docs.mistral.ai/api' },
  { id: 'preset-gemini', kind: 'vendor', tone: 'blue', name: 'Google Gemini', note: 'AI Studio · OpenAI 兼容接口', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', docsUrl: 'https://ai.google.dev/gemini-api/docs/openai', hint: '使用 Google AI Studio 的 Gemini API Key；账号与地区须符合 Google 服务要求。' },
]

const presetChoices = (kind: TextConnectionPreset['kind']) => TEXT_CONNECTION_PRESETS.filter(preset => preset.kind === kind).map(preset => ({ id: preset.id, name: preset.name, note: preset.note, tone: preset.tone }))

export const CLOUD_TEXT_GROUPS: ConnectionChoiceGroup[] = [
  { tone: 'purple', title: '聚合与模型推理平台', description: '先选平台，再选其模型。每个平台使用自己的 Key。', choices: [{ id: 'openrouter', name: 'OpenRouter', note: '多厂商模型目录 · 使用 OpenRouter Key' }, ...presetChoices('platform')] },
  { tone: 'blue', title: '服务商直连', description: '使用对应平台的 Key，与聚合平台的 Key 不通用。', choices: [{ id: 'openai', tone: 'green', name: 'OpenAI', note: 'OpenAI Key' }, { id: 'dashscope', name: '阿里云百炼 DashScope', note: '百炼 Key' }] },
  { tone: 'orange', title: '厂商直连 · 兼容 API', description: '预填官方接口地址；模型 ID 与 Key 由你填写。', choices: presetChoices('vendor') },
  { tone: 'teal', title: '其他服务', description: '填写 API 根地址、准确模型 ID 和该服务的 Key。', choices: [{ id: 'custom', name: '手动接入其他服务', note: 'OpenAI 兼容接口' }] },
]

export const CLOUD_TEXT_PLATFORM_COUNT = CLOUD_TEXT_GROUPS.flatMap(group => group.choices).filter(choice => choice.id !== 'custom').length

export function filterConnectionGroups(groups: ConnectionChoiceGroup[], query: string): ConnectionChoiceGroup[] {
  const term = query.trim().toLowerCase()
  if (!term) return groups
  return groups.flatMap(group => {
    const choices = group.choices.filter(choice => `${group.title} ${choice.id} ${choice.name} ${choice.note}`.toLowerCase().includes(term))
    return choices.length ? [{ ...group, choices }] : []
  })
}
