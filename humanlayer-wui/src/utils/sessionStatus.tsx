export const renderSessionStatus = (
  session: { status: string; archived?: boolean },
  context?: { hasOnlyPendingQuestions?: boolean },
): string => {
  // Show draft status as-is
  if (session.status === 'draft') {
    return 'draft'
  }

  // Always show interrupted status as-is
  if (session.status === 'interrupted') {
    return 'interrupted'
  }

  // If session is completed but not archived, show "waiting_for_input"
  if (session.status === 'completed' && !session.archived) {
    return 'ready_for_input'
  }

  // If session is waiting_input, show context-appropriate label
  if (session.status === 'waiting_input') {
    if (context?.hasOnlyPendingQuestions) {
      return 'awaiting_answer'
    }
    return 'needs_approval'
  }

  // For all other cases, return the status as-is
  return session.status
}
