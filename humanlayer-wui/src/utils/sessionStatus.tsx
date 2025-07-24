export const renderSessionStatus = (session: { status: string; archived?: boolean }): string => {
  // If session is completed but not archived, show "waiting_for_input"
  if (session.status === 'completed' && !session.archived) {
    return 'waiting_for_input'
  }

  // If session is waiting_input, show "needs_approval"
  if (session.status === 'waiting_input') {
    return 'needs_approval'
  }

  // For all other cases, return the status as-is
  return session.status
}
