import type { CreationLanguage } from '@/types'

export type CommunitySection = 'workshop' | 'art'
export const ARTWORK_KINDS = ['character','scene','effect','screenshot','video','audio','other'] as const
export type ArtworkKind = typeof ARTWORK_KINDS[number]
export type ExperimentOutcome = 'completed' | 'partial' | 'failed'
export type MediaKind = 'image' | 'video' | 'audio' | 'game-zip' | 'game-spec' | 'report'
export type CheckState = 'not-tested' | 'passed' | 'failed'

/** Storage object IDs, never Windows paths, API credentials, or expiring model URLs. */
export interface CommunityMedia {
  id: string
  ownerId: string
  runId: string | null
  kind: MediaKind
  storageKey: string
  sha256: string
  bytes: number
  durationSeconds: number | null
  verifiedAt: string | null
}

export interface EvidenceCheck {
  state: CheckState
  evidenceIds: string[]
  note: string
}

export interface ExperimentRecord {
  id: string
  ownerId: string
  pairId: string
  language: CreationLanguage
  tier: 'low' | 'medium' | 'high'
  outcome: ExperimentOutcome
  title: string
  story: string
  levelCount: number
  projectCommit: string
  dirtyWorktree: boolean
  promptVersion: string
  models: { textProvider: string; textModelId: string; imageProvider: string; imageModelId: string }
  timing: Array<{ stage: string; startedAt: string | null; endedAt: string | null; elapsedMs: number | null }>
  usage: { budgetUsd: number; costUsd: number | null; costSource: 'actual' | 'estimated' | 'unknown'; calls: number | null; tokens: number | null }
  fallback: { totalImageTasks: number; supplementedTasks: number; items: Array<{ assetId: string; pose: string | null; source: 'builtin' | 'existing-pose'; reason: string }> }
  checks: Record<'storyFidelity' | 'artQuality' | 'webPlaythrough' | 'offlinePlaythrough', EvidenceCheck>
  issues: Array<{ id: string; severity: 'blocking' | 'major' | 'minor'; description: string; evidenceIds: string[]; proposedFix: string; taskId: string; resolved: boolean }>
  mediaIds: string[]
  templateReview: { state: 'not-reviewed' | 'accepted' | 'rejected'; reviewerId: string | null; reviewedAt: string | null }
}

export interface CommunityPost {
  id: string
  ownerId: string
  section: CommunitySection
  language: CreationLanguage
  title: string
  description: string
  experimentId: string | null
  mediaIds: string[]
  rights: 'original' | 'ai-generated' | 'licensed'
  licenseNote: string
  reuse: 'view-only' | 'download' | 'remix-with-credit'
  artKind?: ArtworkKind
  linkedGameId?: string | null
  moderation: 'draft' | 'pending' | 'published' | 'rejected'
  createdAt: string
}

export interface CommunityActor { userId: string }

/** The display identity is a profile seed; it does not grant an account or role. */
export const IA_PROFILE = { displayName: '【IA】Introvert Arcade' } as const
