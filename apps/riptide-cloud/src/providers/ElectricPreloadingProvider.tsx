import { useLiveQuery } from '@tanstack/react-db'
import type { ReactNode } from 'react'

import { useSync } from '@/providers/SyncProvider'

/**
 * Keeps Electric collections syncing continuously so data is available
 * immediately when navigating between pages.
 *
 * Without this, collections using syncMode: 'on-demand' only sync while
 * a component has an active useLiveQuery subscription. Navigating away
 * tears down the sync stream, causing re-fetches on every page visit.
 */
export function ElectricPreloadingProvider({ children }: { children: ReactNode }) {
	const { tasksCollection, artifactsMetadataCollection } = useSync()

	// Keep tasks collection hot (used by tasks list, breadcrumb, task detail)
	useLiveQuery((q) => q.from({ tasks: tasksCollection }), [tasksCollection])

	// Keep artifacts metadata collection hot (used by breadcrumb, task artifacts list)
	useLiveQuery((q) => q.from({ metadata: artifactsMetadataCollection }), [artifactsMetadataCollection])

	return <>{children}</>
}
