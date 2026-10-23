import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle } from 'lucide-react'
import { useSyncExternalStore } from 'react'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { navigateToSettings } from '@/lib/settings-navigation'

/**
 * Persistent banner displayed when any sync collection is fully offline —
 * meaning both Electric SQL and query-driven sync are failing simultaneously.
 *
 * Subscribes to the CollectionHealthTracker's offline state via
 * useSyncExternalStore so it re-renders only when offline collections change.
 *
 * "View diagnostics" navigates to the Sync settings route.
 */
export function SyncOfflineBanner() {
	const { tracker } = useSyncInternal()
	const navigate = useNavigate()

	// Subscribe to offline state changes. Re-renders only when the set of
	// offline collections changes (additions or removals).
	const offlineCollections = useSyncExternalStore(
		(callback) => tracker.onOfflineChange((_name, _offline) => callback()),
		() => tracker.getOfflineCollections(),
	)

	if (offlineCollections.length === 0) {
		return null
	}

	const handleViewDiagnostics = () => {
		navigateToSettings(navigate, 'sync')
	}

	return (
		<div
			role="alert"
			className="flex items-center justify-between gap-3 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm"
		>
			<div className="flex min-w-0 items-center gap-2">
				<AlertTriangle className="h-4 w-4 shrink-0" />
				<span className="min-w-0">
					Sync offline for{' '}
					{offlineCollections.length === 1
						? offlineCollections[0]
						: `${offlineCollections.length} collections`}
					. Data may be stale until connectivity is restored.
				</span>
			</div>
			<button
				type="button"
				onClick={handleViewDiagnostics}
				className="shrink-0 underline underline-offset-2 hover:no-underline font-medium"
			>
				View diagnostics
			</button>
		</div>
	)
}
