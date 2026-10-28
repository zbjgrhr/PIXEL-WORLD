'use client'

import type { ReactNode } from 'react'

export interface WorkflowFeedback {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description: string
  detail?: string
}

export default function WorkflowNotice({ feedback, children }: { feedback: WorkflowFeedback; children?: ReactNode }) {
  return <div className={`workflow-notice workflow-notice-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
    <strong>{feedback.title}</strong>
    <p>{feedback.description}</p>
    {feedback.detail && <details><summary>查看原因</summary><p>{feedback.detail}</p></details>}
    {children && <div className="workflow-notice-actions">{children}</div>}
  </div>
}
