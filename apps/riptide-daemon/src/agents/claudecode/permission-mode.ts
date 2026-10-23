import type { SessionChangeMessage } from '@/collections/types'
type SdkPermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'auto'

/**
 * Map database permission mode to SDK permission mode.
 */
export function mapToSdkPermissionMode(dbMode: string | null | undefined): SdkPermissionMode {
	switch (dbMode) {
		case 'bypass':
			return 'bypassPermissions'
		case 'accept_edits':
			return 'acceptEdits'
		case 'auto':
			return 'auto'
		default:
			return 'default'
	}
}

/**
 * Check if a change message represents a permission mode change for a specific session.
 */
export function isPermissionModeChangeEvent(change: SessionChangeMessage, sessionId: string): boolean {
	return (
		change.type === 'update' &&
		change.value.id === sessionId &&
		change.previousValue?.permissions_mode !== change.value.permissions_mode
	)
}

/**
 * Subscribe to permission mode changes for a specific session.
 * Calls the provided callback when permission mode changes.
 * Returns unsubscribe function for cleanup.
 */
