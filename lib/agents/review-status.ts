import { dedupeIssues } from './validation'
import type { AgentIssue, AgentRun } from '@/types'

/** The final independent review takes precedence over the reviser's claims. */
export function latestPlanningIssues(run: AgentRun): AgentIssue[] {
  const current = run.tasks.filter(task => task.round === run.currentRound)
  const finished = (task: typeof current[number]) => task.status === 'completed' || task.status === 'needs-review'
  const final = current.find(task => task.id.startsWith('consistencyCritic-final-') && finished(task))
  const coordinator = current.find(task => task.role === 'assetCoordinator' && finished(task))
  const revision = current.find(task => task.role === 'revision' && finished(task))
  if (coordinator) return dedupeIssues(coordinator.issues || [])
  if (final) return dedupeIssues(final.issues || [])
  if (revision) return dedupeIssues(revision.issues || [])
  return dedupeIssues(current.filter(task => task.role === 'consistencyCritic' || task.role === 'engineQa').flatMap(task => task.issues || []))
}
