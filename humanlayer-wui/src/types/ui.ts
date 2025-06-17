import { ApprovalType } from '@/lib/daemon'

// Unified approval request type for UI display
export interface UnifiedApprovalRequest {
  id: string
  callId: string
  runId: string
  type: ApprovalType
  title: string // Formatted title for display
  description: string // Formatted description
  tool?: string // Function name for function calls
  parameters?: Record<string, any> // Function parameters
  createdAt: Date
  // Enriched session context
  sessionId?: string
  sessionQuery?: string
  sessionModel?: string
}

// Types for UI state management
export interface ApprovalState {
  approvals: UnifiedApprovalRequest[]
  loading: boolean
  error: string | null
  lastRefresh: Date | null
}

export interface SessionListState {
  sessions: SessionSummary[]
  loading: boolean
  error: string | null
}

export interface SessionSummary {
  id: string
  runId: string
  status: string
  query: string
  model: string
  startTime: Date
  endTime?: Date
  hasApprovals: boolean
}
