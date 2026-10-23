import type { CodingAgent } from '@humanlayer/schemas/coding-agent'

import { BypassButton } from './action-buttons/bypass-button'
import { PermissionModeButton } from './action-buttons/permission-mode-button'
import type { PermissionsMode, PermissionsModeNoBypass } from '../constants/permission-modes'

export interface DraftActionButtonsProps {
  bypassEnabled: boolean
  bypassTimeoutConfiguredMinutes: number | null
  onToggleBypass: () => void
  permissionsMode: PermissionsMode
  onPermissionModeChange: (mode: PermissionsModeNoBypass) => void
  codingAgent?: CodingAgent
}

export function DraftActionButtons({
  bypassEnabled,
  onToggleBypass,
  permissionsMode,
  onPermissionModeChange,
  codingAgent,
}: DraftActionButtonsProps) {
  return (
    <div className="flex items-center gap-1">
      <BypassButton
        enabled={bypassEnabled}
        onToggle={onToggleBypass}
      />
      <PermissionModeButton
        value={permissionsMode}
        onValueChange={onPermissionModeChange}
        disabled={codingAgent !== undefined && codingAgent !== 'claude'}
        disabledTooltip="Auto-Accept only available for claude code sessions"
      />
    </div>
  )
}
