import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import {
	getAgentPermissionModeConstraint,
	PERMISSION_MODES,
	resolvePermissionsModeForAgent,
	type PermissionsMode,
} from '@humanlayer/ui/constants/permission-modes'
import type { Control } from 'react-hook-form'
import { useController, useWatch } from 'react-hook-form'

import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import type { LauncherV3FormValues } from '@/modules/launcher-v3/launcher-v3-form'

import { LauncherPermissionControl, type LauncherPermissionUnavailableReasons } from './LauncherPermissionControl'

export interface LauncherPermissionControlWiredProps {
	control: Control<LauncherV3FormValues>
	disabled?: boolean
}

export function LauncherPermissionControlWired({ control, disabled }: LauncherPermissionControlWiredProps) {
	const { field: permissionsMode } = useController({ control, name: 'permissionsMode' })
	const agent = useWatch({ control, name: 'agent' })
	const constraint = getAgentPermissionModeConstraint(agent)
	const displayedMode = resolvePermissionsModeForAgent(agent, permissionsMode.value)
	const unavailableReasons = Object.fromEntries(
		PERMISSION_MODES.flatMap((mode) =>
			constraint && mode !== constraint.requiredMode ? [[mode, constraint.unavailableReason]] : [],
		),
	) as LauncherPermissionUnavailableReasons

	const selectPermissionsMode = (nextMode: PermissionsMode) => {
		if (constraint && nextMode !== constraint.requiredMode) return
		permissionsMode.onChange(nextMode)
	}

	useHotkeys(
		hotkeysCatalog.sessionDetail.shortcuts.bypass.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (disabled || constraint) return
			selectPermissionsMode(displayedMode === 'bypass' ? 'default' : 'bypass')
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.TASK_NEW],
		},
		[disabled, constraint, displayedMode, permissionsMode.onChange],
	)

	return (
		<LauncherPermissionControl
			permissionsMode={displayedMode}
			unavailableReasons={unavailableReasons}
			disabled={disabled}
			onSelectPermissionsMode={selectPermissionsMode}
			onBlur={permissionsMode.onBlur}
		/>
	)
}
