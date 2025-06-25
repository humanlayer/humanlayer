import { PendingApproval, ApprovalType, FunctionCall, HumanContact, SessionInfo } from '@/lib/daemon'
import { UnifiedApprovalRequest } from '@/types/ui'
import { truncate, formatParameters } from './formatting'

// Enrich approvals with session context
export function enrichApprovals(
  approvals: PendingApproval[],
  sessions: SessionInfo[],
): UnifiedApprovalRequest[] {
  // Create lookup map for sessions by runId
  const sessionsByRunId = new Map<string, SessionInfo>()
  sessions.forEach(session => {
    sessionsByRunId.set(session.run_id, session)
  })

  return approvals.map(approval => {
    if (approval.type === ApprovalType.FunctionCall && approval.function_call) {
      return enrichFunctionCall(approval.function_call, sessionsByRunId)
    } else if (approval.type === ApprovalType.HumanContact && approval.human_contact) {
      return enrichHumanContact(approval.human_contact, sessionsByRunId)
    }

    // Fallback for unknown types
    return {
      id: 'unknown',
      callId: 'unknown',
      runId: 'unknown',
      type: approval.type,
      title: 'Unknown approval type',
      description: '',
      createdAt: new Date(),
    }
  })
}

function enrichFunctionCall(
  fc: FunctionCall,
  sessionsByRunId: Map<string, SessionInfo>,
): UnifiedApprovalRequest {
  const session = sessionsByRunId.get(fc.run_id)

  // Build title
  let title = `Call ${fc.spec.fn}`
  if (Object.keys(fc.spec.kwargs).length > 0) {
    const params = formatParameters(fc.spec.kwargs, 50)
    title += ` with ${params}`
  }

  // Build description with more details
  const description = JSON.stringify(fc.spec.kwargs, null, 2)

  return {
    id: fc.call_id,
    callId: fc.call_id,
    runId: fc.run_id,
    type: ApprovalType.FunctionCall,
    title,
    description,
    tool: fc.spec.fn,
    parameters: fc.spec.kwargs,
    createdAt: fc.status?.requested_at ? new Date(fc.status.requested_at) : new Date(),
    // Session context
    sessionId: session?.id,
    sessionQuery: session ? session.summary || truncate(session.query, 50) : undefined,
    sessionModel: session?.model || 'default',
  }
}

function enrichHumanContact(
  hc: HumanContact,
  sessionsByRunId: Map<string, SessionInfo>,
): UnifiedApprovalRequest {
  const session = sessionsByRunId.get(hc.run_id)

  // Title is the subject or first line of message
  const title = hc.spec.subject || truncate(hc.spec.msg, 50)

  return {
    id: hc.call_id,
    callId: hc.call_id,
    runId: hc.run_id,
    type: ApprovalType.HumanContact,
    title,
    description: hc.spec.msg,
    createdAt: hc.status?.requested_at ? new Date(hc.status.requested_at) : new Date(),
    // Session context
    sessionId: session?.id,
    sessionQuery: session ? session.summary || truncate(session.query, 50) : undefined,
    sessionModel: session?.model || 'default',
  }
}

// Group approvals by session for display
export function groupApprovalsBySession(
  approvals: UnifiedApprovalRequest[],
): Map<string, UnifiedApprovalRequest[]> {
  const grouped = new Map<string, UnifiedApprovalRequest[]>()

  approvals.forEach(approval => {
    const key = approval.sessionId || 'no-session'
    const list = grouped.get(key) || []
    list.push(approval)
    grouped.set(key, list)
  })

  // Sort each group by creation time (newest first)
  grouped.forEach(list => {
    list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  })

  return grouped
}
