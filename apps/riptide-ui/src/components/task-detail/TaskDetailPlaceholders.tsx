import { Skeleton } from '@humanlayer/ui/components/skeleton'

import { AppBreadcrumb } from '@/components/AppBreadcrumb'
import { DetailPageNotFound } from '@/components/DetailPageStatus'

const SESSION_ROW_SKELETON_KEYS = ['session-row-1', 'session-row-2', 'session-row-3', 'session-row-4']

export function TaskDetailLoading() {
	return (
		<div className="flex h-full min-h-0 flex-col pb-4">
			<AppBreadcrumb />
			<div role="status" aria-label="Loading task" className="flex min-h-0 flex-1 flex-col gap-3">
				<div className="shrink-0 space-y-3 bg-foreground/6 p-4">
					<Skeleton className="h-5 w-2/5" />
					<Skeleton className="h-3 w-3/5" />
					<div className="flex gap-2 pt-1">
						<Skeleton className="h-7 w-28" />
						<Skeleton className="h-7 w-24" />
					</div>
				</div>
				<div className="flex flex-col gap-2 px-4">
					{SESSION_ROW_SKELETON_KEYS.map((rowKey) => (
						<div key={rowKey} className="grid grid-cols-[1fr_6rem_4rem] items-center gap-4 py-2">
							<Skeleton className="h-4" />
							<Skeleton className="h-4" />
							<Skeleton className="h-4" />
						</div>
					))}
					<p className="pt-2 text-center text-sm text-muted-foreground">Loading task…</p>
				</div>
			</div>
		</div>
	)
}

export function TaskDetailNotFound() {
	return (
		<DetailPageNotFound
			title="Task not found"
			description="It may have been deleted, or it may belong to a different organization."
			backTo={{ label: 'Back to tasks', path: '/sessions?tab=tasks' }}
		/>
	)
}
