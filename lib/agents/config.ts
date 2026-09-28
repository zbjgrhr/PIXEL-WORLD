import type { AgentProviderId, AgentRole, LocalAgentProviderId } from '@/types'

export interface AgentTextModelConfig {
  id: string
  label: string
  supportsVision?: boolean
}

export interface AgentProviderConfig {
  id: AgentProviderId
  label: string
  envKey: string
  keyHint: string
  models: AgentTextModelConfig[]
}

export const AGENT_PROVIDERS: AgentProviderConfig[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envKey: 'OPENROUTER_API_KEY',
    keyHint: 'OpenRouter API Key',
    models: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', supportsVision: true },
      { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', supportsVision: true },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    keyHint: 'OpenAI API Key',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', supportsVision: true },
      { id: 'gpt-4.1', label: 'GPT-4.1', supportsVision: true },
    ],
  },
  {
    id: 'dashscope',
    label: 'Alibaba DashScope',
    envKey: 'DASHSCOPE_API_KEY',
    keyHint: 'DashScope API Key',
    models: [
      { id: 'qwen-plus', label: 'Qwen Plus' },
      { id: 'qwen-max', label: 'Qwen Max' },
    ],
  },
]

export const LOCAL_AGENT_PROVIDERS: Array<{ id: LocalAgentProviderId; label: string; baseUrl?: string; instructions: string; downloadUrl: string }> = [
  { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', instructions: '安装 Ollama 并下载模型；浏览器直接连接本机服务。', downloadUrl: 'https://ollama.com/download' },
  { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', instructions: '在 LM Studio 下载并加载模型，再启动 Local Server。', downloadUrl: 'https://lmstudio.ai/download' },
  { id: 'gpt4all', label: 'GPT4All', baseUrl: 'http://127.0.0.1:4891/v1', instructions: '在 GPT4All 下载模型并开启 Local API Server。', downloadUrl: 'https://www.nomic.ai/gpt4all' },
  { id: 'jan', label: 'Jan', baseUrl: 'http://127.0.0.1:1337/v1', instructions: '在 Jan 下载模型并启动 API Server；本地密码只留在当前浏览器会话。', downloadUrl: 'https://jan.ai/download' },
  { id: 'webllm', label: 'WebLLM', instructions: '无需安装桌面软件；首次在浏览器中下载模型，需要 WebGPU。', downloadUrl: 'https://github.com/mlc-ai/web-llm' },
]

export function isLocalAgentProvider(provider: AgentProviderId): provider is LocalAgentProviderId {
  return LOCAL_AGENT_PROVIDERS.some((item) => item.id === provider)
}

export function localProviderConfig(provider: LocalAgentProviderId) {
  return LOCAL_AGENT_PROVIDERS.find((item) => item.id === provider)!
}

export const AGENT_ROLE_LABELS: Record<AgentRole, { en: string; zh: string; description: string }> = {
  director: { en: 'Director', zh: '总控', description: '理解需求并建立创作简报' },
  narrative: { en: 'Narrative', zh: '叙事', description: '设计世界观、冲突与背景故事' },
  mechanics: { en: 'Mechanics', zh: '玩法', description: '设计战斗、数值与进阶节奏' },
  artDirector: { en: 'Art Director', zh: '美术总监', description: '建立一致的像素美术规范' },
  levelDesigner: { en: 'Level Designer', zh: '关卡设计', description: '规划逐关内容与难度曲线' },
  integrator: { en: 'Integrator', zh: '规格整合', description: '合并为可执行 GameSpec V3' },
  consistencyCritic: { en: 'Consistency Critic', zh: '一致性评审', description: '检查美术、叙事和素材矛盾' },
  engineQa: { en: 'Engine QA', zh: '引擎检查', description: '检查玩法闭环和引擎可执行性' },
  revision: { en: 'Revision', zh: '修订', description: '根据评审修复规格' },
  assetCoordinator: { en: 'Asset Coordinator', zh: '素材统筹', description: '整理最终素材提示词与关卡分配' },
  visualQa: { en: 'Visual QA', zh: '视觉检查', description: '检查生成素材完整度与一致性' },
  playtest: { en: 'Playtest', zh: '试玩检查', description: '检查通关、战斗和关卡条件' },
  publisher: { en: 'Publisher', zh: '发布检查', description: '汇总发布阻断项与建议' },
}

export function getAgentProvider(provider: AgentProviderId): AgentProviderConfig {
  return AGENT_PROVIDERS.find((item) => item.id === provider) || AGENT_PROVIDERS[0]
}

export function getDefaultAgentModel(provider: AgentProviderId): string {
  return getAgentProvider(provider).models[0]?.id || 'google/gemini-2.5-flash'
}

export function agentModelSupportsVision(provider: AgentProviderId, model: string): boolean {
  return Boolean(getAgentProvider(provider).models.find((item) => item.id === model)?.supportsVision)
}
