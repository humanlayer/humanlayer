import { useCallback, useSyncExternalStore } from 'react'

import { useSync } from '@/providers/SyncProvider'

export function useIsSyncing() {
	const collections = useSync()

	const subscribe = useCallback(
		(callback: () => void) => {
			const cleanups = Object.values(collections).map((c) => c.on('status:change', callback))
			return () => {
				for (const off of cleanups) {
					off()
				}
			}
		},
		[collections],
	)

	const getSnapshot = useCallback(() => {
		return Object.values(collections).some((c) => {
			try {
				return c.status === 'loading'
			} catch {
				return false
			}
		})
	}, [collections])

	return useSyncExternalStore(subscribe, getSnapshot)
}
