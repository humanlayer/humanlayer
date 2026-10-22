import { SyncGridAnimation } from '@humanlayer/ui/components/sync-grid-animation'

import { AppBreadcrumb } from '@/components/AppBreadcrumb'
import { ResourceNotFound } from '@/components/ResourceNotFound'

// The app shell skips the breadcrumb on detail routes, so states shown before the page layout render their own.
export function DetailPageLoading({ label }: { label: string }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<AppBreadcrumb />
			<div role="status" className="flex flex-1 flex-col items-center justify-center gap-3">
				<SyncGridAnimation variant="snake" size="lg" speed={120} className="text-accent" />
				<p className="text-sm text-muted-foreground">{label}</p>
			</div>
		</div>
	)
}

export function DetailPageNotFound({
	title,
	description,
	backTo,
}: {
	title: string
	description: string
	backTo: { label: string; path: string }
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<AppBreadcrumb />
			<div className="min-h-0 flex-1">
				<ResourceNotFound title={title} description={description} backTo={backTo} />
			</div>
		</div>
	)
}
