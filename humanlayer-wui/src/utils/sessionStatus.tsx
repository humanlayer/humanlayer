export const renderSessionStatus = (session: { status: string; archived?: boolean }): string => {
  // Show draft status as-is
  if (session.status === 'draft') {
    return 'Draft'
  }

  // Always show interrupted status as-is
  if (session.status === 'interrupted') {
    return 'interrupted'
  }

  // If session is completed but not archived, show "waiting_for_input"
  if (session.status === 'completed' && !session.archived) {
    return 'ready_for_input'
  }

  // If session is waiting_input, show "needs_approval"
  if (session.status === 'waiting_input') {
    return 'needs_approval'
  }

  // For all other cases, return the status as-is
  return session.status
}
