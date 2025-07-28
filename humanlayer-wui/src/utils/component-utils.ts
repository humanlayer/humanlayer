/**
 * Utility functions for component styling based on session status
 */

export function getStatusTextClass(status: string): string {
  switch (status) {
    case 'waiting_input':
      return 'font-bold text-[var(--terminal-warning)]'
    case 'running':
      return 'text-[var(--terminal-success)] font-bold'
    case 'interrupted':
      return '' // No special styling for interrupted status
    default:
      return ''
  }
}

export function getStatusBackgroundClass(status: string): string {
  switch (status) {
    case 'waiting_input':
      return 'bg-[var(--terminal-warning)]/10'
    case 'running':
      return 'bg-[var(--terminal-success)]/10'
    case 'interrupted':
      return '' // No special styling for interrupted status
    default:
      return ''
  }
}
