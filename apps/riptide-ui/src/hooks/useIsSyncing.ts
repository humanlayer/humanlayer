import { useCallback, useSyncExternalStore } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

/**
 * True while any collection is loading. Uses useSyncExternalStore so a `status:change`
 * that fires while another component is rendering (e.g. a lazy collection activated by a
 * live query in render) is handled by React instead of a setState-during-render warning.
 */
export function useIsSyncing() {
	const collections = useSync()

	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			const cleanups = Object.values(collections).map((c) => c.on('status:change', onStoreChange))
			return () => {
				for (const off of cleanups) off()
			}
		},
		[collections],
	)

	const getSnapshot = useCallback(
		() =>
			Object.values(collections).some((c) => {
				try {
					return c.status === 'loading'
				} catch {
					return false
				}
			}),
		[collections],
	)

	return useSyncExternalStore(subscribe, getSnapshot)
}
