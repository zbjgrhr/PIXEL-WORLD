'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Card, Collapse, Input, Progress, Select, Space, Tag, Typography, message } from 'antd'
import { CheckCircle2, CircleStop, FlaskConical, Pause, Play, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { loadAgentApiKey, loadAgentApiPrefs, saveAgentApiPrefs } from '@/lib/agent-api-prefs'
import { AGENT_PROVIDERS, AGENT_ROLE_LABELS, LOCAL_AGENT_PROVIDERS, getAgentProvider, getDefaultAgentModel, isLocalAgentProvider, localProviderConfig } from '@/lib/agents/config'
import { discoverLocalModels, safeLocalBaseUrl, testLocalAgentConnection } from '@/lib/agents/local-client'
import { inspectWebLlm, prepareWebLlm } from '@/lib/agents/webllm-client'
import { countBlockingIssues } from '@/lib/agents/validation'
import { useAgentCluster } from '@/hooks/useAgentCluster'
import type { AgentExecuteRequest, AgentExecuteResponse, AgentProviderId, AgentTaskStatus, GameSpec } from '@/types'
import ApiPlatformGuide from './ui/ApiPlatformGuide'
import { getApiPlatformGuide } from '@/configs/api-platform-guide'
import { customConnectionError, EMPTY_CUSTOM_CONNECTION, loadAiAccessMode, loadCustomConnection, saveAiAccessMode, saveCustomConnection, type AiAccessMode, type CustomConnection } from '@/lib/custom-connection'
import AiAccessTabs from './ui/AiAccessTabs'
import CustomConnectionFields from './ui/CustomConnectionFields'
import AiProviderChoice from './ui/AiProviderChoice'
import ReadyAgentGuide, { READY_AGENT_VISUALS } from './ui/ReadyAgentGuide'
import StageHeading from './ui/StageHeading'

const { Paragraph, Text, Title } = Typography

interface AgentStudioProps {
  embedded?: boolean
  projectId: string
  sourcePrompt: string
  projectName: string
  briefReady: boolean
  levelCount: number
  baseSpec?: GameSpec | null
  onOptimizePrompt?: () => Promise<GameSpec | null>
  isOptimizing?: boolean
  onSpecReady: (spec: GameSpec) => void
  onApproved: (spec: GameSpec) => void
  onTextConnectionChange?: (connection: { provider?: AgentProviderId; model?: string; apiKey: string; baseUrl?: string }) => void
  reviewTarget?: HTMLDivElement | null
  inputRevision?: number
}

const STATUS_COLOR: Record<AgentTaskStatus, string> = {
  waiting: 'default', running: 'processing', completed: 'success', 'needs-review': 'warning', failed: 'error', cancelled: 'default',
}

const RUN_LABELS = {
  draft: '等待启动', planning: '策划中', reviewing: '交叉评审中', awaiting_approval: '等待确认', producing: '已批准，可生成素材',
  quality_check: '生成后检查中', ready: '可以发布', paused: '已暂停', failed: '需要处理', cancelled: '已取消',
} as const

function generatedAssetCount(spec?: GameSpec | null): number {
  if (!spec) return 0
  return spec.assets.filter((asset) => Boolean(asset.url) || Boolean(asset.animation?.clips && Object.values(asset.animation.clips).some((clip) => clip?.url))).length
}

function estimatedImageJobs(spec?: GameSpec | null): number {
  if (!spec) return 0
  return spec.assets.filter((asset) => asset.enabled && (asset.kind === 'image' || asset.kind === 'spriteSheet')).reduce((total, asset) => {
    if (asset.kind !== 'spriteSheet') return total + 1
    const clips = asset.animation?.clips ? Object.values(asset.animation.clips).filter((clip) => clip?.enabled).length : 1
    return total + Math.max(1, clips)
  }, 0)
}

function artifactPreview(output?: Record<string, unknown>): string {
  if (!output) return ''
  const json = JSON.stringify(output, null, 2)
  return json.length > 20000 ? `${json.slice(0, 20000)}\n…（内容过长，已在界面截断）` : json
}

export default function AgentStudio({ embedded = false, projectId, sourcePrompt, projectName, briefReady, levelCount, baseSpec, onOptimizePrompt, isOptimizing = false, onSpecReady, onApproved, onTextConnectionChange, reviewTarget, inputRevision = 0 }: AgentStudioProps) {
  const [provider, setProvider] = useState<AgentProviderId>('openrouter')
  const [accessMode, setAccessMode] = useState<AiAccessMode>('ready')
  const [readyProvider, setReadyProvider] = useState<AgentProviderId | null>(null)
  const [ownProvider, setOwnProvider] = useState<AgentProviderId>('openrouter')
  const [customAgent, setCustomAgent] = useState<CustomConnection>(EMPTY_CUSTOM_CONNECTION)
  const [model, setModel] = useState(getDefaultAgentModel('openrouter'))
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [localModels, setLocalModels] = useState<Array<{ value: string; label: string }>>([])
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1')
  const [localPassword, setLocalPassword] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [localCheck, setLocalCheck] = useState<{ state: 'idle' | 'checking' | 'ready' | 'failed'; text: string }>({ state: 'idle', text: '' })
  const [webLlmSetup, setWebLlmSetup] = useState<{ state: 'idle' | 'checking' | 'preparing' | 'ready' | 'failed'; progress: number; text: string; cached?: boolean }>({ state: 'idle', progress: 0, text: '' })
  const webLlmAttempt = useRef(0)
  const cluster = useAgentCluster({ projectId, sourcePrompt, projectName, levelCount, baseSpec, onSpecReady, onApproved })
  const seenInputRevision = useRef(inputRevision)

  useEffect(() => {
    if (!cluster.run || seenInputRevision.current === inputRevision) return
    seenInputRevision.current = inputRevision
    if (!['draft', 'cancelled'].includes(cluster.run.status)) void cluster.reset()
  }, [inputRevision, cluster.run, cluster.reset])

  useEffect(() => {
    const prefs = loadAgentApiPrefs()
    const mode = loadAiAccessMode('agent')
    const savedReady = (localStorage.getItem('pixel-world-agent-ready-choice') || localStorage.getItem('pixel-local-provider')) as AgentProviderId | null
    const ready = savedReady && isLocalAgentProvider(savedReady) ? savedReady : null
    const own = localStorage.getItem('pixel-world-agent-own-choice') === 'custom' ? 'custom' : prefs.provider
    setAccessMode(mode)
    setReadyProvider(ready)
    setOwnProvider(own)
    setCustomAgent(loadCustomConnection('agent'))
    setProvider(mode === 'ready' ? ready || prefs.provider : own)
    setModel(mode === 'ready' && ready && isLocalAgentProvider(ready)
      ? localStorage.getItem(`pixel-local-model-${ready}`) || ''
      : mode === 'own' && own === 'custom' ? loadCustomConnection('agent').model : prefs.model)
    if (mode === 'ready' && ready && isLocalAgentProvider(ready)) {
      setBaseUrl(localStorage.getItem(`pixel-local-url-${ready}`) || localProviderConfig(ready).baseUrl || '')
    }
    setApiKey(prefs.apiKey)
  }, [])

  useEffect(() => {
    const selected = accessMode === 'own' || readyProvider !== null
    const chosenModel = provider === 'custom' ? customAgent.model.trim() : model.trim()
    if (!selected || !chosenModel || provider === 'managed') return onTextConnectionChange?.({ apiKey: '' })
    onTextConnectionChange?.({
      provider,
      model: chosenModel,
      apiKey: provider === 'custom' ? customAgent.apiKey.trim() : isLocalAgentProvider(provider) ? localPassword : apiKey.trim(),
      baseUrl: provider === 'custom' ? customAgent.baseUrl.trim() : isLocalAgentProvider(provider) && provider !== 'webllm' ? baseUrl.trim() : undefined,
    })
  }, [accessMode, readyProvider, provider, model, apiKey, customAgent, localPassword, baseUrl, onTextConnectionChange])

  const persist = (nextProvider = provider, nextModel = model, nextKey = apiKey) => {
    if (nextProvider !== 'custom' && nextProvider !== 'managed' && !isLocalAgentProvider(nextProvider)) saveAgentApiPrefs({ provider: nextProvider, model: nextModel, apiKey: nextKey })
  }

  const tasks = cluster.run?.tasks || []
  const completed = tasks.filter((task) => task.status === 'completed' || task.status === 'needs-review').length
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0
  const totalTokens = tasks.reduce((sum, task) => sum + (task.usage?.totalTokens || 0), 0)
  const issues = useMemo(() => {
    const quality = tasks.filter((task) => task.phase === 'quality')
    if (quality.length) return quality.flatMap((task) => task.issues || [])
    const current = tasks.filter((task) => task.round === cluster.run?.currentRound)
    const final = current.find((task) => task.role === 'assetCoordinator' && task.status === 'completed')
      || current.find((task) => task.role === 'revision' && (task.status === 'completed' || task.status === 'needs-review'))
    return final ? final.issues || [] : current.filter((task) => task.role === 'consistencyCritic' || task.role === 'engineQa').flatMap((task) => task.issues || [])
  }, [cluster.run?.currentRound, tasks])
  const blocking = countBlockingIssues(issues)
  const locked = Boolean(cluster.run && !['draft', 'cancelled'].includes(cluster.run.status))
  useEffect(() => {
    if (!locked || !cluster.run) return
    const lock = cluster.run.modelLock
    setProvider(lock.provider)
    if (lock.provider === 'custom') { setAccessMode('own'); setOwnProvider('custom') }
    else if (lock.provider === 'managed') { setAccessMode('ready'); setReadyProvider(null) }
    else if (isLocalAgentProvider(lock.provider)) { setAccessMode('ready'); setReadyProvider(lock.provider) }
    else { setAccessMode('own'); setOwnProvider(lock.provider) }
    setModel(lock.model)
    if (lock.baseUrl) setBaseUrl(lock.baseUrl)
    if (isLocalAgentProvider(lock.provider)) setLocalModels([{ value: lock.model, label: lock.model }])
  }, [locked, cluster.run?.modelLock.provider, cluster.run?.modelLock.model, cluster.run?.modelLock.baseUrl])
  const hasImages = generatedAssetCount(baseSpec) > 0
  const plannedSpec = cluster.run?.artifacts.productionSpec || cluster.run?.artifacts.revisedSpec || cluster.run?.artifacts.mergedSpec
  const plannedJobs = estimatedImageJobs(plannedSpec)

  const changeProvider = (value: AgentProviderId) => {
    if (value === 'custom') {
      setProvider(value)
      setModel(customAgent.model)
      return
    }
    if (isLocalAgentProvider(value)) {
      setProvider(value)
      setModel(localStorage.getItem(`pixel-local-model-${value}`) || '')
      setBaseUrl(localStorage.getItem(`pixel-local-url-${value}`) || localProviderConfig(value).baseUrl || '')
      setLocalPassword('')
      setLocalModels([])
      setLocalCheck({ state: 'idle', text: '' })
      setWebLlmSetup({ state: 'idle', progress: 0, text: '' })
      webLlmAttempt.current += 1
      localStorage.setItem('pixel-local-provider', value)
      return
    }
    const savedPrefs = loadAgentApiPrefs()
    const nextModel = savedPrefs.provider === value ? savedPrefs.model : getDefaultAgentModel(value)
    const nextKey = loadAgentApiKey(value)
    setProvider(value)
    setModel(nextModel)
    setApiKey(nextKey)
    persist(value, nextModel, nextKey)
  }

  const changeAccessMode = (mode: AiAccessMode) => {
    setAccessMode(mode)
    saveAiAccessMode('agent', mode)
    if (mode === 'ready' && readyProvider) changeProvider(readyProvider)
    if (mode === 'own') changeProvider(ownProvider)
  }

  const selectProvider = (value: AgentProviderId) => {
    if (accessMode === 'ready') {
      setReadyProvider(value)
      localStorage.setItem('pixel-world-agent-ready-choice', value)
    } else {
      setOwnProvider(value)
      localStorage.setItem('pixel-world-agent-own-choice', value)
    }
    changeProvider(value)
  }

  const changeCustomAgent = (value: CustomConnection) => {
    setCustomAgent(value)
    saveCustomConnection('agent', value)
    if (provider === 'custom') setModel(value.model)
  }

  const selected = accessMode === 'own' || readyProvider !== null
  const legacyManagedRun = cluster.run?.modelLock.provider === 'managed'
  const activeKey = provider === 'custom' ? customAgent.apiKey.trim() : isLocalAgentProvider(provider) ? localPassword : apiKey.trim()
  const activeBaseUrl = provider === 'custom' ? customAgent.baseUrl.trim() : isLocalAgentProvider(provider) && provider !== 'webllm' ? safeLocalBaseUrl(baseUrl) : undefined

  const testAgentApi = async () => {
    if (!selected) return void message.error('请先选择一个可用的文字 Agent 工具。')
    if (provider === 'custom') { const issue = customConnectionError(customAgent); if (issue) return void message.error(issue) }
    if (!isLocalAgentProvider(provider) && !activeKey) return void message.error('请先填写文字 Agent API Key。')
    if (!(provider === 'custom' ? customAgent.model : model).trim()) return void message.error('请先检测并选择模型。')
    setTesting(true)
    try {
      if (!isLocalAgentProvider(provider) && provider !== 'custom') {
        const body: AgentExecuteRequest = {
          runId: `agent-test-${Date.now()}`, taskId: 'director-test', role: 'director', round: 1,
          provider, model, apiKey: apiKey.trim(), sourcePrompt: 'Create a minimal original pixel platform game test brief.',
          projectName: 'Agent API Test', levelCount: 1, artifacts: {},
        }
        const response = await fetch('/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const result = await response.json().catch(() => null) as AgentExecuteResponse | null
        if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
        message.success(`Agent API 可用，锁定模型：${model}`)
        return
      }
      if (isLocalAgentProvider(provider)) {
        setLocalCheck({ state: 'checking', text: provider === 'webllm' ? '正在发送短文字测试…' : '正在向本机模型发送短文字测试…' })
        await testLocalAgentConnection(provider, model, activeBaseUrl, activeKey)
        setLocalCheck({ state: 'ready', text: '文字模型可用。完整 GameSpec 会在你启动 Agent 后才生成。' })
        message.success('文字模型已通过短测试。')
        return
      }
      const body: AgentExecuteRequest = {
        runId: `agent-test-${Date.now()}`, taskId: 'director-test', role: 'director', round: 1,
        provider, model: customAgent.model.trim(), apiKey: activeKey, baseUrl: activeBaseUrl,
        sourcePrompt: 'Create a minimal original pixel platform game test brief.', projectName: 'Agent API Test', levelCount: 1, artifacts: {},
      }
      const response = await fetch('/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null) as AgentExecuteResponse | null
      if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
      message.success(`自定义文字服务可用，锁定模型：${customAgent.model.trim()}`)
    } catch (error) {
      if (isLocalAgentProvider(provider)) setLocalCheck({ state: 'failed', text: error instanceof Error ? error.message : '本机文字模型测试失败。' })
      message.error(error instanceof Error ? error.message : 'Agent API 测试失败。')
    } finally {
      setTesting(false)
    }
  }

  const checkLocalTool = async () => {
    if (!isLocalAgentProvider(provider)) return
    setDiscovering(true)
    setLocalCheck({ state: 'checking', text: provider === 'webllm' ? '正在检查浏览器与可选模型…' : '正在检查本机服务与已加载模型…' })
    try {
      const models = await discoverLocalModels(provider, baseUrl, localPassword)
      setLocalModels(models.map((item) => ({ value: item.id, label: item.label })))
      if (!models.length) throw new Error(provider === 'webllm' ? '没有找到适合浏览器运行的 WebLLM 模型。' : '没有检测到已下载并加载的模型。')
      const selectedModel = models.some((item) => item.id === model) ? model : models[0].id
      setModel(selectedModel)
      if (provider === 'webllm') {
        const readiness = await inspectWebLlm(selectedModel)
        setWebLlmSetup({ state: readiness.cached ? 'checking' : 'idle', progress: readiness.cached ? 0 : 0, text: readiness.cached ? '浏览器已缓存该模型；仍需加载到显卡。' : '浏览器和模型列表可用；下一步准备模型。', cached: readiness.cached })
      }
      setLocalCheck({ state: 'ready', text: provider === 'webllm' ? '浏览器支持 WebLLM。请先准备模型，再进行短文字测试。' : `已找到 ${models.length} 个本机模型。请选择一个，再测试文字模型。` })
    } catch (error) {
      const text = error instanceof Error ? error.message : '模型检查失败。'
      setLocalCheck({ state: 'failed', text })
      if (provider === 'webllm') setWebLlmSetup({ state: 'failed', progress: 0, text })
      message.error(text)
    } finally {
      setDiscovering(false)
    }
  }

  const prepareBrowserModel = async () => {
    if (provider !== 'webllm' || !model.trim()) return void message.error('请先检查浏览器并选择模型。')
    const attempt = ++webLlmAttempt.current
    setWebLlmSetup({ state: 'preparing', progress: 0, text: '正在连接模型下载源…' })
    let timeout: number | undefined
    try {
      const prepared = prepareWebLlm(model, ({ progress, text }) => {
        if (webLlmAttempt.current === attempt) setWebLlmSetup({ state: 'preparing', progress, text })
      })
      await Promise.race([
        prepared,
        new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error('模型准备超过 30 秒仍未完成。下载源或 WebGPU 可能没有响应；请改用 Ollama、LM Studio，或使用本地草案继续。')), 30_000) }),
      ])
      if (webLlmAttempt.current !== attempt) return
      setWebLlmSetup({ state: 'ready', progress: 1, text: '模型已加载到浏览器，可以测试文字模型。', cached: true })
      message.success('浏览器模型已经准备好。')
    } catch (error) {
      if (webLlmAttempt.current !== attempt) return
      const text = error instanceof Error ? error.message : '浏览器模型准备失败。'
      setWebLlmSetup({ state: 'failed', progress: 0, text })
      message.error(text)
      webLlmAttempt.current += 1
    } finally {
      if (timeout) window.clearTimeout(timeout)
    }
  }

  const start = async () => {
    if (!selected) return void message.error('请先选择一个可用的文字 Agent 工具。')
    if (provider === 'custom') { const issue = customConnectionError(customAgent); if (issue) return void message.error(issue) }
    if (!isLocalAgentProvider(provider) && !activeKey) return void message.error('请先填写文字 Agent API Key。')
    if (!(provider === 'custom' ? customAgent.model : model).trim()) return void message.error('请先检测并选择模型。')
    if (!baseSpec) return void message.error('请先补全提示词并检查草案，再启动 Agent 集群。')
    await cluster.start({ provider, model: provider === 'custom' ? customAgent.model.trim() : model, baseUrl: activeBaseUrl }, activeKey, baseSpec)
  }

  const runAgentAction = async (action: () => Promise<unknown>) => {
    try {
      if (legacyManagedRun) throw new Error('这个历史运行使用已移除的站点云端服务；请新建运行并选择文字工具。')
      await action()
    } catch (error) { message.error(error instanceof Error ? error.message : 'Agent 操作失败。') }
  }

  return <Card
    size="small"
    className={embedded ? 'agent-studio-embedded' : undefined}
    title={embedded ? undefined : <StageHeading number="02" title="文字策划" english="TEXT AGENTS" />}
    extra={!embedded && cluster.run && <Tag color={cluster.run.status === 'ready' ? 'success' : cluster.run.status === 'failed' ? 'error' : 'blue'}>{RUN_LABELS[cluster.run.status]}</Tag>}
  >
    {embedded && cluster.run && <div className="agent-embedded-status"><span>当前策划进度</span><Tag color={cluster.run.status === 'ready' ? 'success' : cluster.run.status === 'failed' ? 'error' : 'blue'}>{RUN_LABELS[cluster.run.status]}</Tag></div>}
    <Alert
      type="info"
      showIcon
      message="所有文字 Agent 在本次运行中共用一个锁定模型；所有图片仍使用素材区锁定的图片模型。生图前必须由你批准。"
      style={{ marginBottom: 12 }}
    />
    {legacyManagedRun && <div className="ai-ready-empty" role="status"><strong>历史云端运行只供查看</strong><span>站点体验已结束。要继续策划，请新建运行并选择本机工具或自己的 AI 服务。</span></div>}
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <AiAccessTabs value={accessMode} onChange={changeAccessMode} kind="agent" disabled={locked} />
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Select<AgentProviderId>
          value={selected ? provider : undefined}
          disabled={locked}
          onChange={selectProvider}
          placeholder={accessMode === 'ready' ? '选择可用工具' : '选择服务商'}
          style={{ width: '100%' }}
          options={accessMode === 'own' ? [...AGENT_PROVIDERS.map((item) => {
            const guide = getApiPlatformGuide(item.id)
            return {
              value: item.id,
              label: <AiProviderChoice name={item.label} note={guide.strengths[0]} color={guide.accent} />,
            }
          }), { value: 'custom' as AgentProviderId, label: <AiProviderChoice name="手动接入其他服务" note="自定义接口" color="#317d70" /> }] : LOCAL_AGENT_PROVIDERS.map((item) => ({ value: item.id as AgentProviderId, label: <AiProviderChoice name={item.label} note={READY_AGENT_VISUALS[item.id].note} color={READY_AGENT_VISUALS[item.id].color} /> }))}
        />
        {selected && provider !== 'custom' && <Select
          value={model || undefined}
          disabled={locked}
          onChange={(value) => {
            setModel(value)
            if (isLocalAgentProvider(provider)) {
              localStorage.setItem(`pixel-local-model-${provider}`, value)
              setLocalCheck({ state: 'idle', text: '' })
              if (provider === 'webllm') {
                webLlmAttempt.current += 1
                setWebLlmSetup({ state: 'idle', progress: 0, text: '' })
              }
            } else persist(provider, value, apiKey)
          }}
          style={{ width: '100%' }}
          options={isLocalAgentProvider(provider) ? localModels : getAgentProvider(provider).models.map((item) => ({ value: item.id, label: item.label }))}
        />}
        {selected && provider !== 'custom' && provider !== 'managed' && !isLocalAgentProvider(provider) && <Input.Password
          value={apiKey}
          onChange={(event) => { const value = event.target.value; setApiKey(value); persist(provider, model, value) }}
          placeholder={getAgentProvider(provider).keyHint}
          style={{ width: '100%' }}
          autoComplete="new-password"
        />}
      </Space>

      {accessMode === 'ready' && !readyProvider && <div className="ai-ready-empty" role="status"><strong>先选一个文字 Agent 工具</strong><span>选择后查看安装与测试步骤；本机工具需下载模型，WebLLM 在浏览器下载模型。</span></div>}

      {selected && provider === 'custom' && <CustomConnectionFields kind="agent" value={customAgent} onChange={changeCustomAgent} disabled={locked} />}
      {selected && isLocalAgentProvider(provider) && <>
        <Space wrap style={{ width: '100%' }}>
          {provider !== 'webllm' && <Input value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); localStorage.setItem(`pixel-local-url-${provider}`, event.target.value) }} placeholder="本地 API 地址" style={{ minWidth: 260, flex: 1 }} />}
          {provider !== 'webllm' && <Input.Password value={localPassword} onChange={(event) => setLocalPassword(event.target.value)} placeholder={provider === 'jan' ? 'Jan 本地访问密码（仅当前页面）' : '本地服务密码（如有，仅当前页面）'} style={{ minWidth: 240 }} />}
          <Button loading={discovering} onClick={() => { void checkLocalTool() }}>{provider === 'webllm' ? '检查浏览器' : '检查本机服务'}</Button>
        </Space>
        {provider === 'webllm' && <div className={`webllm-setup webllm-setup-${webLlmSetup.state}`}>
          <div className="webllm-setup-heading"><div><strong>准备浏览器模型</strong><span>首次需要下载并加载模型；这一步不生成 GameSpec。</span></div><Tag color={webLlmSetup.state === 'ready' ? 'success' : webLlmSetup.state === 'failed' ? 'error' : webLlmSetup.state === 'preparing' ? 'processing' : 'default'}>{webLlmSetup.state === 'ready' ? '已准备' : webLlmSetup.state === 'failed' ? '需要处理' : webLlmSetup.state === 'preparing' ? '准备中' : '未准备'}</Tag></div>
          {webLlmSetup.state === 'preparing' && <Progress percent={Math.round(webLlmSetup.progress * 100)} status="active" size="small" />}
          <p>{webLlmSetup.text || '先检查浏览器，再准备所选模型。模型下载源不可访问时会显示错误，不会把等待伪装成测试。'}</p>
          <Button type="primary" loading={webLlmSetup.state === 'preparing'} disabled={!model || webLlmSetup.state === 'ready'} onClick={() => { void prepareBrowserModel() }}>{webLlmSetup.state === 'ready' ? '浏览器模型已准备' : '准备模型'}</Button>
        </div>}
        {localCheck.state !== 'idle' && <Alert type={localCheck.state === 'ready' ? 'success' : localCheck.state === 'failed' ? 'error' : 'info'} showIcon message={localCheck.text} style={{ marginTop: 2 }} />}
      </>}
      {selected && accessMode === 'ready' && !legacyManagedRun && <Collapse size="small" items={[{ key: 'ready-help', label: '安装与使用说明', children: <ReadyAgentGuide provider={provider} /> }]} />}

      {selected && provider !== 'custom' && provider !== 'managed' && !isLocalAgentProvider(provider) && <Collapse size="small" items={[{ key: 'api-help', label: '平台接入说明', children: <ApiPlatformGuide selectedId={provider} mode="agent" /> }]} />}

      <div className="agent-workflow-action">
        <Text strong>先补全构想，再启动 Agent 评审</Text>
        <Text type="secondary">{!briefReady ? '请先在游戏构想中填写名称和故事。' : baseSpec ? '草案已建立，可以检查后启动 Agent 集群；重新补全会更新草案。' : selected ? '已选择文字工具。补全会调用当前模型；云端服务可能收费。' : '未选择文字工具时会生成本地草案；运行 Agent 前还需选择模型。'}</Text>
        <Button type="primary" icon={<Sparkles size={14} />} loading={isOptimizing} disabled={!briefReady || locked || legacyManagedRun} onClick={() => { void onOptimizePrompt?.() }}>
          一键补全并优化提示词
        </Button>
      </div>
      <Space wrap>
        <Button icon={<FlaskConical size={14} />} disabled={!selected || legacyManagedRun || (provider === 'webllm' && webLlmSetup.state !== 'ready')} loading={testing} onClick={() => { void testAgentApi() }}>{!selected ? '选择工具后测试' : provider === 'custom' ? '测试连接' : isLocalAgentProvider(provider) ? '测试文字模型' : '测试 Agent API'}</Button>
        {(!cluster.run || ['draft', 'failed', 'cancelled'].includes(cluster.run.status)) && <Button type="primary" disabled={!selected || !baseSpec || isOptimizing || legacyManagedRun} icon={<Play size={14} />} onClick={() => { void start() }}>启动 Agent 集群</Button>}
        {cluster.run && ['planning', 'reviewing'].includes(cluster.run.status) && <Button icon={<Pause size={14} />} onClick={cluster.pause}>暂停</Button>}
        {cluster.run?.status === 'paused' && <Button type="primary" disabled={legacyManagedRun} icon={<Play size={14} />} onClick={() => { void runAgentAction(() => cluster.resume(activeKey)) }}>继续</Button>}
        {cluster.run && ['planning', 'reviewing', 'paused'].includes(cluster.run.status) && <Button danger icon={<CircleStop size={14} />} onClick={cluster.cancel}>取消</Button>}
        {cluster.run && <Button icon={<RotateCcw size={14} />} onClick={() => { void cluster.reset() }}>新建运行</Button>}
        {cluster.run?.status === 'awaiting_approval' && cluster.run.artifacts.productionSpec && blocking === 0 && <Button type="primary" icon={<CheckCircle2 size={14} />} onClick={() => { void cluster.approve() }}>批准规格并开放生图</Button>}
        {cluster.run?.approved && hasImages && <Button icon={<ShieldCheck size={14} />} disabled={legacyManagedRun} onClick={() => baseSpec && void runAgentAction(() => cluster.runQualityChecks(baseSpec, activeKey))}>运行生成后检查</Button>}
      </Space>

      {selected && isLocalAgentProvider(provider) && baseSpec && !cluster.run?.approved && (!cluster.run || ['draft', 'failed', 'cancelled'].includes(cluster.run.status)) && <div className="local-draft-review-option">
        <strong>本机模型做不出完整规格？</strong>
        <span>可以用已补全的本地草案继续。系统先查关卡和素材是否可用，所选灵感会列出供你核对；仍需你批准后才能制作素材。</span>
        <Button onClick={() => { void cluster.reviewLocalDraft(baseSpec, { provider, model: model.trim() || '本地规则草案', baseUrl: activeBaseUrl }) }}>检查本地草案并继续</Button>
      </div>}

      {reviewTarget && createPortal(<div className="agent-review-content">{cluster.run ? <>
        {cluster.run.reviewMode === 'local-draft' && <Alert type="info" showIcon message="本地草案待你审核" description="已运行规则检查，未运行完整 Agent 集群。请核对故事、所选灵感和关卡；有阻断项时先修改草案。" />}
        <div>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text>Agent 进度 {completed}/{tasks.length}</Text>
            <Text type="secondary">Token {totalTokens.toLocaleString()} · 阻断项 {blocking}</Text>
          </Space>
          <Progress percent={progress} status={cluster.run.status === 'failed' ? 'exception' : cluster.run.status === 'ready' ? 'success' : 'active'} />
        </div>
        {cluster.run.status === 'awaiting_approval' && plannedSpec && <Alert
          type={blocking ? 'warning' : 'success'}
          showIcon
          message={blocking ? `仍有 ${blocking} 个阻断项，已停止自动修订` : `规划已通过：预计 ${plannedJobs} 个图片任务`}
          description={blocking ? '请按字段路径修改原始构想，再补全草案并重新检查；此时不会调用图片 API。' : `共 ${plannedSpec.assets.filter((asset) => asset.enabled).length} 个已启用素材、${plannedSpec.levels.length} 个关卡。批准后仍可在素材卡片中关闭项目或调整关卡分配。`}
        />}
        {cluster.run.error && <Alert type="error" showIcon message={cluster.run.error} />}
        <Collapse
          size="small"
          items={tasks.map((task) => {
            const label = AGENT_ROLE_LABELS[task.role]
            const actionableIssues = (task.issues || []).filter((item) => item.severity !== 'info')
            const advisoryIssues = (task.issues || []).filter((item) => item.severity === 'info')
            return {
              key: task.id,
              label: <Space wrap><Text strong>{label.zh} / {label.en}</Text><Tag color={STATUS_COLOR[task.status]}>{task.status}</Tag>{task.round > 1 && <Tag>第 {task.round} 轮</Tag>}</Space>,
              children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Text type="secondary">{label.description}</Text>
                {task.summary && <Paragraph style={{ margin: 0 }}>{task.summary}</Paragraph>}
                {task.output && <Collapse size="small" items={[{
                  key: `${task.id}-artifact`,
                  label: '查看结构化成果',
                  children: <pre style={{ margin: 0, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 11 }}>{artifactPreview(task.output)}</pre>,
                }]} />}
                {actionableIssues.map((item) => <Alert key={item.id} type={item.severity === 'blocking' ? 'error' : 'warning'} showIcon message={item.message} description={`${item.path} · ${item.suggestion}`} />)}
                {advisoryIssues.length > 0 && <Collapse size="small" items={[{
                  key: `${task.id}-advice`,
                  label: `可选优化建议 ${advisoryIssues.length} 条（不会阻止继续）`,
                  children: <Space direction="vertical" size={8} style={{ width: '100%' }}>
                    {advisoryIssues.map((item) => <Alert key={item.id} type="info" showIcon message={item.message} description={`${item.path} · ${item.suggestion}`} />)}
                  </Space>,
                }]} />}
                {task.error && <Alert type="error" showIcon message={task.error} />}
                <Space>
                  {task.usage && <Text type="secondary">Token: {task.usage.totalTokens}</Text>}
                  {(task.status === 'failed' || task.status === 'completed' || task.status === 'needs-review') && <Button size="small" disabled={legacyManagedRun} icon={<RotateCcw size={12} />} onClick={() => { void runAgentAction(() => cluster.retryTask(task.id, activeKey)) }}>{task.status === 'failed' ? '重试该 Agent' : '重新运行该 Agent'}</Button>}
                </Space>
              </Space>,
            }
          })}
        />
        {cluster.run.artifacts.releaseReport && <Card size="small" style={{ background: '#f6ffed' }}>
          <Title level={5} style={{ marginTop: 0 }}>发布检查</Title>
          <Paragraph style={{ marginBottom: 0 }}>{String(cluster.run.artifacts.releaseReport.summary || (cluster.run.artifacts.releaseReport.ready ? '所有阻断项已通过。' : '仍有需要处理的阻断项。'))}</Paragraph>
        </Card>}
      </> : <div className="agent-review-empty"><strong>等待开始策划</strong><span>先在“游戏构想”填写名称和故事，再到左栏选择文字模型、补全提示词并启动 Agent 集群。</span></div>}</div>, reviewTarget)}
    </Space>
  </Card>
}
