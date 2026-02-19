export type WaitingInputReason = 'approval' | 'question'

const waitingInputDisplayStatus: Record<WaitingInputReason, string> = {
  approval: 'needs_approval',
  question: 'awaiting_answer',
}

export const renderSessionStatus = (
  session: { status: string; archived?: boolean },
  context?: { waitingReason?: WaitingInputReason },
): string => {
  switch (session.status) {
    case 'draft':
      return 'draft'
    case 'interrupted':
      return 'interrupted'
    case 'completed':
      return session.archived ? 'completed' : 'ready_for_input'
    case 'waiting_input':
      return waitingInputDisplayStatus[context?.waitingReason ?? 'approval']
    default:
      return session.status
  }
}
