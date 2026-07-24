import type { AgentRole, AgentTask } from '@/types'

interface TaskTemplate {
  role: AgentRole
  phase: AgentTask['phase']
  dependencies: AgentRole[]
}

const PLANNING_GRAPH: TaskTemplate[] = [
  { role: 'director', phase: 'planning', dependencies: [] },
  { role: 'narrative', phase: 'planning', dependencies: ['director'] },
  { role: 'mechanics', phase: 'planning', dependencies: ['director'] },
  { role: 'artDirector', phase: 'planning', dependencies: ['director'] },
  { role: 'levelDesigner', phase: 'planning', dependencies: ['narrative', 'mechanics', 'artDirector'] },
  { role: 'integrator', phase: 'planning', dependencies: ['levelDesigner'] },
  { role: 'consistencyCritic', phase: 'review', dependencies: ['integrator'] },
  { role: 'engineQa', phase: 'review', dependencies: ['integrator'] },
  { role: 'revision', phase: 'review', dependencies: ['consistencyCritic', 'engineQa'] },
  { role: 'assetCoordinator', phase: 'production', dependencies: ['revision'] },
]

export function taskId(role: AgentRole, round = 1): string {
  return `${role}-r${round}`
}

export function createPlanningTasks(round = 1): AgentTask[] {
  return PLANNING_GRAPH.map((template) => ({
    id: taskId(template.role, round),
    role: template.role,
    phase: template.phase,
    round,
    dependencies: template.dependencies.map((role) => taskId(role, round)),
    status: 'waiting',
    attempts: 0,
  }))
}

export function createQualityTasks(round = 1): AgentTask[] {
  return [
    { id: taskId('visualQa', round), role: 'visualQa', phase: 'quality', round, dependencies: [], status: 'waiting', attempts: 0 },
    { id: taskId('playtest', round), role: 'playtest', phase: 'quality', round, dependencies: [], status: 'waiting', attempts: 0 },
    { id: taskId('publisher', round), role: 'publisher', phase: 'quality', round, dependencies: [taskId('visualQa', round), taskId('playtest', round)], status: 'waiting', attempts: 0 },
  ]
}

export function runnableTasks(tasks: AgentTask[]): AgentTask[] {
  const completed = new Set(tasks.filter((task) => task.status === 'completed' || task.status === 'needs-review').map((task) => task.id))
  return tasks.filter((task) => task.status === 'waiting' && task.dependencies.every((dependency) => completed.has(dependency)))
}
