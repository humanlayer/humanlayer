import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

import { BypassButton } from './action-buttons/bypass-button'
import { PermissionModeButton } from './action-buttons/permission-mode-button'
import { AutoAdvanceButton } from './action-buttons/auto-advance-button'
import { ArchiveButton } from './action-buttons/archive-button'
import { ForkButton } from './action-buttons/fork-button'
import type { PermissionsMode, PermissionsModeNoBypass } from '../constants/permission-modes'

// Session statuses that indicate an "active" session requiring confirmation to archive
const ACTIVE_SESSION_STATUSES = [
  'running',
  'needs_approval',
  'launching',
  'resuming',
] as const

export interface SessionActionButtonsProps {
  // Bypass state
  bypassEnabled: boolean
  bypassTimeoutMinutes: number | null
  onToggleBypass: () => void
  // Permission mode state
  permissionsMode: PermissionsMode
  onPermissionModeChange: (mode: PermissionsModeNoBypass) => void
  codingAgent?: CodingAgent
  // Auto-advance state (optional - only shown for research-questions sessions)
  showAutoAdvance?: boolean
  autoAdvanceEnabled?: boolean
  autoAdvanceNextStepName?: string
  onToggleAutoAdvance?: () => void
  // Fork state (optional)
  showFork?: boolean
  onFork?: () => void
  forkDisabled?: boolean
  // Archive state
  isArchived: boolean
  sessionStatus: string
  onToggleArchive: () => void
  /** Keycaps for the archive tooltip, one `<kbd>` per entry. Defaults to `['e']`. */
  archiveShortcutKeys?: readonly string[]
  promptControlsDisabled?: boolean
  showOwnerControls?: boolean
}

export function SessionActionButtons({
  bypassEnabled,
  onToggleBypass,
  permissionsMode,
  onPermissionModeChange,
  codingAgent,
  showAutoAdvance,
  autoAdvanceEnabled,
  autoAdvanceNextStepName,
  onToggleAutoAdvance,
  showFork,
  onFork,
  forkDisabled,
  isArchived,
  sessionStatus,
  onToggleArchive,
  archiveShortcutKeys,
  promptControlsDisabled = false,
  showOwnerControls = true,
}: SessionActionButtonsProps) {
  const isActiveSession = ACTIVE_SESSION_STATUSES.includes(
    sessionStatus as (typeof ACTIVE_SESSION_STATUSES)[number]
  )

  return (
    <div className="flex items-center gap-1">
      <BypassButton
        enabled={bypassEnabled}
        onToggle={onToggleBypass}
        disabled={promptControlsDisabled}
      />
      <PermissionModeButton
        value={permissionsMode}
        onValueChange={onPermissionModeChange}
        disabled={promptControlsDisabled || (codingAgent !== undefined && codingAgent !== 'claude')}
        disabledTooltip="Auto-Accept only available for claude code sessions"
        showShortcut
      />
      {showOwnerControls && showAutoAdvance && onToggleAutoAdvance && (
        <AutoAdvanceButton enabled={autoAdvanceEnabled ?? false} onToggle={onToggleAutoAdvance} nextStepName={autoAdvanceNextStepName ?? 'next step'} />
      )}
      {showOwnerControls && <ArchiveButton
        isArchived={isArchived}
        isActiveSession={isActiveSession}
        onToggle={onToggleArchive}
        shortcutKeys={archiveShortcutKeys}
      />}
      {showOwnerControls && showFork && onFork && (
        <ForkButton onFork={onFork} disabled={forkDisabled} />
      )}
    </div>
  )
}
