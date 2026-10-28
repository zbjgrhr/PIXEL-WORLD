import { describe, expect, it } from 'vitest'
import { finalReviewTaskId, taskId } from './graph'
import { latestPlanningIssues } from './review-status'
import type { AgentIssue, AgentRun, AgentTask } from '@/types'

const issue = (id: string): AgentIssue => ({ id, severity: 'blocking', source: 'consistencyCritic', path: 'narrative.ending', message: id, suggestion: '修订剧情' })
const task = (id: string, role: AgentTask['role'], status: AgentTask['status'], issues: AgentIssue[] = []): AgentTask => ({ id, role, phase: 'review', round: 2, dependencies: [], status, attempts: 1, issues })
const run = (tasks: AgentTask[]) => ({ currentRound: 2, tasks }) as AgentRun

describe('independent final Agent review', () => {
  it('uses the last independent verdict over a reviser claiming success', () => {
    const reviewed = run([
      task(taskId('revision', 2), 'revision', 'completed'),
      task(finalReviewTaskId(2), 'consistencyCritic', 'needs-review', [issue('ending-too-early')]),
    ])
    expect(latestPlanningIssues(reviewed).map(item => item.id)).toEqual(['ending-too-early'])
  })

  it('uses production checks after a clean final review', () => {
    const reviewed = run([
      task(taskId('revision', 2), 'revision', 'completed', [issue('old')]),
      task(finalReviewTaskId(2), 'consistencyCritic', 'completed'),
      task(taskId('assetCoordinator', 2), 'assetCoordinator', 'completed', [issue('asset-regression')]),
    ])
    expect(latestPlanningIssues(reviewed).map(item => item.id)).toEqual(['asset-regression'])
  })
})
