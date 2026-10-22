import type { SessionStatus } from './types'

/**
 * Get the CSS variable color for a phase based on its label name.
 * Duplicates the mapping from session-label-badge.tsx getLabelColor.
 */
export function getPhaseColor(labelName: string): string {
  if (labelName.startsWith('rpi:todo'))             return 'var(--terminal-fg-dim)'
  if (labelName.startsWith('rpi:research-questions')) return 'var(--terminal-label-blue, var(--terminal-accent))'
  if (labelName.startsWith('rpi:research'))         return 'var(--terminal-label-green, var(--terminal-success))'
  if (labelName.startsWith('rpi:design'))           return 'var(--terminal-label-purple, var(--terminal-accent-alt))'
  if (labelName.startsWith('rpi:structure'))        return 'var(--terminal-label-pink, var(--terminal-warning))'
  if (labelName.startsWith('rpi:plan'))             return 'color-mix(in srgb, var(--terminal-label-pink, var(--terminal-color-13)) 65%, var(--terminal-label-purple, var(--terminal-color-13)))'
  if (labelName.startsWith('rpi:worktree-setup'))   return 'var(--terminal-fg-dim)'
  if (labelName.startsWith('rpi:implementation'))   return 'var(--terminal-label-green, var(--terminal-success))'
  if (labelName.startsWith('rpi:describe-pr'))      return 'var(--terminal-label-blue, var(--terminal-color-12))'
  return 'var(--terminal-fg)'
}

/** Get the CSS variable color for a session status */
export function getStatusColor(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'var(--terminal-success)'
    case 'launching':
    case 'resuming':
      return 'var(--terminal-accent)'
    case 'failed':
      return 'var(--terminal-error)'
    case 'lost':
    case 'waiting_for_usage_limit':
      return 'var(--terminal-warning)'
    case 'ready_for_input':
    case 'needs_approval':
    case 'interrupt_requested':
    case 'interrupted':
      return 'var(--terminal-warning)'
    case 'ready_for_launch':
    case 'draft':
    default:
      return 'var(--terminal-fg-dim)'
  }
}

/** Get a human-readable label for a session status */
export function getStatusLabel(status: SessionStatus): string {
  switch (status) {
    case 'running': return 'running'
    case 'launching': return 'launching'
    case 'resuming': return 'resuming'
    case 'failed': return 'failed'
    case 'lost': return 'lost'
    case 'waiting_for_usage_limit': return 'usage limit'
    case 'ready_for_input': return 'ready'
    case 'needs_approval': return 'needs approval'
    case 'interrupt_requested': return 'interrupting'
    case 'interrupted': return 'interrupted'
    case 'ready_for_launch': return 'queued'
    case 'draft': return 'draft'
    default: return status
  }
}

/** Strip leading yyyy-mm-dd- date prefix from artifact filenames */
export function stripDatePrefix(fileName: string): string {
  return fileName.replace(/^\d{4}-\d{2}-\d{2}-/, '')
}

/** CSS variable color for artifact categories */
export const ARTIFACT_CATEGORY_COLORS = {
  source: 'var(--terminal-accent)',
  edited: 'var(--terminal-warning)',
  new:    'var(--terminal-success)',
} as const
