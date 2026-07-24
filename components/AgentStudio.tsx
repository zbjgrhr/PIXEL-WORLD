'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Collapse, Input, Progress, Select, Space, Tag, Typography, message } from 'antd'
import { Bot, CheckCircle2, CircleStop, FlaskConical, Pause, Play, RotateCcw, ShieldCheck } from 'lucide-react'
import { loadAgentApiKey, loadAgentApiPrefs, saveAgentApiPrefs } from '@/lib/agent-api-prefs'
import { AGENT_PROVIDERS, AGENT_ROLE_LABELS, getAgentProvider, getDefaultAgentModel } from '@/lib/agents/config'
import { countBlockingIssues } from '@/lib/agents/validation'
import { useAgentCluster } from '@/hooks/useAgentCluster'
import type { AgentExecuteRequest, AgentExecuteResponse, AgentProviderId, AgentTaskStatus, GameSpec } from '@/types'
import ApiPlatformGuide from './ui/ApiPlatformGuide'
import { getApiPlatformGuide } from '@/configs/api-platform-guide'

const { Paragraph, Text, Title } = Typography

interface AgentStudioProps {
  projectId: string
  sourcePrompt: string
  projectName: string
  levelCount: number
  baseSpec?: GameSpec | null
  onSpecReady: (spec: GameSpec) => void
  onApproved: (spec: GameSpec) => void
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

export default function AgentStudio({ projectId, sourcePrompt, projectName, levelCount, baseSpec, onSpecReady, onApproved }: AgentStudioProps) {
  const [provider, setProvider] = useState<AgentProviderId>('openrouter')
  const [model, setModel] = useState(getDefaultAgentModel('openrouter'))
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const cluster = useAgentCluster({ projectId, sourcePrompt, projectName, levelCount, baseSpec, onSpecReady, onApproved })

  useEffect(() => {
    const prefs = loadAgentApiPrefs()
    setProvider(prefs.provider)
    setModel(prefs.model)
    setApiKey(prefs.apiKey)
  }, [])

  const persist = (nextProvider = provider, nextModel = model, nextKey = apiKey) => {
    saveAgentApiPrefs({ provider: nextProvider, model: nextModel, apiKey: nextKey })
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
  const locked = Boolean(cluster.run && !['draft', 'failed', 'cancelled'].includes(cluster.run.status))
  const hasImages = generatedAssetCount(baseSpec) > 0
  const plannedSpec = cluster.run?.artifacts.productionSpec || cluster.run?.artifacts.revisedSpec || cluster.run?.artifacts.mergedSpec
  const plannedJobs = estimatedImageJobs(plannedSpec)

  const changeProvider = (value: AgentProviderId) => {
    const nextModel = getDefaultAgentModel(value)
    const nextKey = loadAgentApiKey(value)
    setProvider(value)
    setModel(nextModel)
    setApiKey(nextKey)
    persist(value, nextModel, nextKey)
  }

  const testAgentApi = async () => {
    if (!apiKey.trim()) return void message.error('请先填写文字 Agent API Key。')
    setTesting(true)
    try {
      const body: AgentExecuteRequest = {
        runId: `agent-test-${Date.now()}`, taskId: 'director-test', role: 'director', round: 1,
        provider, model, apiKey: apiKey.trim(), sourcePrompt: 'Create a minimal original pixel platform game test brief.',
        projectName: 'Agent API Test', levelCount: 1, artifacts: {},
      }
      const response = await fetch('/api/agents/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const result = await response.json().catch(() => null) as AgentExecuteResponse | null
      if (!response.ok || !result?.success) throw new Error(result?.error || `HTTP ${response.status}`)
      message.success(`Agent API 可用，锁定模型：${model}`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'Agent API 测试失败。')
    } finally {
      setTesting(false)
    }
  }

  const start = async () => {
    if (!sourcePrompt.trim()) return void message.error('请先填写结构化游戏构想。')
    if (!apiKey.trim()) return void message.error('请先填写文字 Agent API Key。')
    await cluster.start({ provider, model }, apiKey.trim())
  }

  return <Card
    size="small"
    title={<Space><Bot size={18} /><span>Agent Studio / 多 Agent 游戏工作室</span></Space>}
    extra={cluster.run && <Tag color={cluster.run.status === 'ready' ? 'success' : cluster.run.status === 'failed' ? 'error' : 'blue'}>{RUN_LABELS[cluster.run.status]}</Tag>}
  >
    <Alert
      type="info"
      showIcon
      message="所有文字 Agent 在本次运行中共用一个锁定模型；所有图片仍使用素材区锁定的图片模型。生图前必须由你批准。"
      style={{ marginBottom: 12 }}
    />
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space wrap style={{ width: '100%' }}>
        <Select
          value={provider}
          disabled={locked}
          onChange={changeProvider}
          style={{ minWidth: 160 }}
          options={AGENT_PROVIDERS.map((item) => {
            const guide = getApiPlatformGuide(item.id)
            return {
              value: item.id,
              label: <span className="provider-select-option"><i style={{ background: guide.accent }} /><span>{item.label}</span><small style={{ color: guide.accent }}>{guide.strengths[0]}</small></span>,
            }
          })}
        />
        <Select
          value={model}
          disabled={locked}
          onChange={(value) => { setModel(value); persist(provider, value, apiKey) }}
          style={{ minWidth: 220 }}
          options={getAgentProvider(provider).models.map((item) => ({ value: item.id, label: item.label }))}
        />
        <Input.Password
          value={apiKey}
          onChange={(event) => { const value = event.target.value; setApiKey(value); persist(provider, model, value) }}
          placeholder={getAgentProvider(provider).keyHint}
          style={{ minWidth: 240, flex: 1 }}
          autoComplete="new-password"
        />
      </Space>

      <ApiPlatformGuide selectedId={provider} mode="agent" />

      <Space wrap>
        <Button icon={<FlaskConical size={14} />} loading={testing} onClick={() => { void testAgentApi() }}>测试 Agent API</Button>
        {(!cluster.run || ['draft', 'failed', 'cancelled'].includes(cluster.run.status)) && <Button type="primary" icon={<Play size={14} />} onClick={() => { void start() }}>启动 Agent 集群</Button>}
        {cluster.run && ['planning', 'reviewing'].includes(cluster.run.status) && <Button icon={<Pause size={14} />} onClick={cluster.pause}>暂停</Button>}
        {cluster.run?.status === 'paused' && <Button type="primary" icon={<Play size={14} />} onClick={() => { void cluster.resume(apiKey.trim()) }}>继续</Button>}
        {cluster.run && ['planning', 'reviewing', 'paused'].includes(cluster.run.status) && <Button danger icon={<CircleStop size={14} />} onClick={cluster.cancel}>取消</Button>}
        {cluster.run && <Button icon={<RotateCcw size={14} />} onClick={() => { void cluster.reset() }}>新建运行</Button>}
        {cluster.run?.status === 'awaiting_approval' && cluster.run.artifacts.productionSpec && blocking === 0 && <Button type="primary" icon={<CheckCircle2 size={14} />} onClick={() => { void cluster.approve() }}>批准规格并开放生图</Button>}
        {cluster.run?.approved && hasImages && <Button icon={<ShieldCheck size={14} />} onClick={() => baseSpec && void cluster.runQualityChecks(baseSpec, apiKey.trim())}>运行生成后检查</Button>}
      </Space>

      {cluster.run && <>
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
          description={blocking ? '请按字段路径修改原始构想或重新运行相关 Agent；此时不会调用图片 API。' : `共 ${plannedSpec.assets.filter((asset) => asset.enabled).length} 个已启用素材、${plannedSpec.levels.length} 个关卡。批准后仍可在素材卡片中关闭项目或调整关卡分配。`}
        />}
        {cluster.run.error && <Alert type="error" showIcon message={cluster.run.error} />}
        <Collapse
          size="small"
          items={tasks.map((task) => {
            const label = AGENT_ROLE_LABELS[task.role]
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
                {task.issues?.map((item) => <Alert key={item.id} type={item.severity === 'blocking' ? 'error' : item.severity === 'warning' ? 'warning' : 'info'} showIcon message={item.message} description={`${item.path} · ${item.suggestion}`} />)}
                {task.error && <Alert type="error" showIcon message={task.error} />}
                <Space>
                  {task.usage && <Text type="secondary">Token: {task.usage.totalTokens}</Text>}
                  {(task.status === 'failed' || task.status === 'completed' || task.status === 'needs-review') && <Button size="small" icon={<RotateCcw size={12} />} onClick={() => { void cluster.retryTask(task.id, apiKey.trim()) }}>{task.status === 'failed' ? '重试该 Agent' : '重新运行该 Agent'}</Button>}
                </Space>
              </Space>,
            }
          })}
        />
        {cluster.run.artifacts.releaseReport && <Card size="small" style={{ background: '#f6ffed' }}>
          <Title level={5} style={{ marginTop: 0 }}>发布检查</Title>
          <Paragraph style={{ marginBottom: 0 }}>{String(cluster.run.artifacts.releaseReport.summary || (cluster.run.artifacts.releaseReport.ready ? '所有阻断项已通过。' : '仍有需要处理的阻断项。'))}</Paragraph>
        </Card>}
      </>}
    </Space>
  </Card>
}
