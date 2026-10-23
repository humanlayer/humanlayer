const LEGACY_NEXT_STEP_DISMISSED_KEY_PREFIX = 'riptide-next-step-dismissed.'
const LEGACY_SESSION_SIDEBAR_COLLAPSED_KEY_PREFIX = 'riptide-sidebar-collapsed.'
const LEGACY_TASK_SIDEBAR_COLLAPSED_KEY_PREFIX = 'riptide-task-detail-sidebar-collapsed.'
const LEGACY_SESSION_SIDEBAR_TAB_KEY_PREFIX = 'riptide-sidebar-tab.'
const LEGACY_SESSION_SIDEBAR_ARTIFACT_KEY_PREFIX = 'riptide-sidebar-artifact.'
const LEGACY_NEW_TASK_SHARE_WITH_ORG_KEY = 'new-task-share-with-org'

export function clearLegacyLocalStorage(): void {
	try {
		if (typeof localStorage === 'undefined') return

		const keysToRemove: string[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (
				key?.startsWith(LEGACY_NEXT_STEP_DISMISSED_KEY_PREFIX) ||
				key?.startsWith(LEGACY_SESSION_SIDEBAR_COLLAPSED_KEY_PREFIX) ||
				key?.startsWith(LEGACY_TASK_SIDEBAR_COLLAPSED_KEY_PREFIX) ||
				key?.startsWith(LEGACY_SESSION_SIDEBAR_TAB_KEY_PREFIX) ||
				key?.startsWith(LEGACY_SESSION_SIDEBAR_ARTIFACT_KEY_PREFIX)
			) {
				keysToRemove.push(key)
			}
		}

		for (const key of keysToRemove) localStorage.removeItem(key)
		localStorage.removeItem(LEGACY_NEW_TASK_SHARE_WITH_ORG_KEY)
	} catch {
		// SSR / private mode - no-op
	}
}
