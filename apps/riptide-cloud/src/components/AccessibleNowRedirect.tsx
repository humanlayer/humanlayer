import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'

import { useMountEffect } from '@/hooks/useMountEffect'
import { useSync } from '@/providers/SyncProvider'

export function AccessibleNowRedirect() {
	const { artifactsCollection } = useSync()

	useMountEffect(() => {
		// The artifact is now accessible, but a query-backed collection may still
		// hold the previous empty predicate result. Ask the collection to refresh
		// its active queries instead of guessing at its TanStack Query keys.
		if ('refetch' in artifactsCollection.utils) {
			void artifactsCollection.utils.refetch()
		}
	})

	return (
		<div className="flex items-center justify-center h-full">
			<div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
				<SyncGridAnimation variant="snake" speed={120} className="w-8" />
				<span>Loading artifact...</span>
			</div>
		</div>
	)
}
