import { WifiOff } from 'lucide-react'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'

/**
 * Persistent banner displayed when the browser is offline.
 * Sync (both Electric and query-driven) is unavailable without a network
 * connection, so we surface this prominently above the app content.
 */
export function NetworkOfflineBanner() {
	const networkStatus = useNetworkStatus()

	if (networkStatus !== 'offline') {
		return null
	}

	return (
		<div
			role="alert"
			className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 text-destructive text-sm"
		>
			<WifiOff className="h-4 w-4 shrink-0" />
			<span>Network offline: sync is unavailable and will resume when your connection is online.</span>
		</div>
	)
}
