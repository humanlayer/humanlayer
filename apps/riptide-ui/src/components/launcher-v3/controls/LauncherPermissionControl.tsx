import { BypassButton, PermissionModeButton } from '@humanlayer/ui/components/action-buttons'
import type { PermissionsMode, PermissionsModeNoBypass } from '@humanlayer/ui/constants/permission-modes'

export type LauncherPermissionUnavailableReasons = Partial<Readonly<Record<PermissionsMode, string>>>

export interface LauncherPermissionControlProps {
	permissionsMode: PermissionsMode
	unavailableReasons: LauncherPermissionUnavailableReasons
	disabled?: boolean
	onSelectPermissionsMode: (mode: PermissionsMode) => void
	onBlur: () => void
}

/**
 * The same icon-only bypass toggle and permission-mode pair as
 * ContinueSessionInput: a shield that toggles bypass, and a fast-forward menu
 * for the non-bypass modes, both greyed out until a non-default mode is active.
 */
export function LauncherPermissionControl({
	permissionsMode,
	unavailableReasons,
	disabled = false,
	onSelectPermissionsMode,
	onBlur,
}: LauncherPermissionControlProps) {
	// A constrained agent (e.g. CodeLayer requires bypass) marks every other
	// mode unavailable; both buttons lock with that reason.
	const constraintReason = unavailableReasons.default ?? unavailableReasons.auto ?? unavailableReasons.accept_edits

	return (
		<div className="flex items-center gap-1 text-foreground" onBlur={onBlur}>
			<BypassButton
				enabled={permissionsMode === 'bypass'}
				disabled={disabled || constraintReason !== undefined}
				disabledTooltip={constraintReason}
				onToggle={() => onSelectPermissionsMode(permissionsMode === 'bypass' ? 'default' : 'bypass')}
			/>
			<PermissionModeButton
				value={permissionsMode}
				onValueChange={(mode: PermissionsModeNoBypass) => onSelectPermissionsMode(mode)}
				disabled={disabled || constraintReason !== undefined}
				disabledTooltip={constraintReason}
			/>
		</div>
	)
}
