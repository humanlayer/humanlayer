import { useCallback, useState } from 'react'

import { useSettingsStore } from '@/hooks/stores/settingsStore'

/**
 * Gates the first "enable Fast Mode" click behind a warning modal. Once the
 * user confirms, future enables fire `commit` directly. Disabling (next=false)
 * is never gated.
 */
export function useFastModeToggleGuard(commit: (next: boolean) => void) {
	const acknowledged = useSettingsStore((s) => s.fastModeWarningAcknowledged)
	const acknowledge = useSettingsStore((s) => s.acknowledgeFastModeWarning)
	const [pendingEnable, setPendingEnable] = useState(false)

	const onToggle = useCallback(
		(next: boolean) => {
			if (next && !acknowledged) {
				setPendingEnable(true)
				return
			}
			commit(next)
		},
		[acknowledged, commit],
	)

	const confirm = useCallback(
		(dontAskAgain = true) => {
			if (dontAskAgain) acknowledge()
			commit(true)
			setPendingEnable(false)
		},
		[acknowledge, commit],
	)

	return {
		onToggle,
		pendingEnable,
		setPendingEnable,
		confirm,
	}
}
