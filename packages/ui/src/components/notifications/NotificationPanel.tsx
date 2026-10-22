import type { ReactNode } from 'react'

export function NotificationPanel({
	count,
	activeRowId,
	children,
}: {
	count: number
	activeRowId: string | undefined
	children: ReactNode
}) {
	return (
		<div className="flex max-h-[min(36rem,70vh)] flex-col font-mono">
			<div className="flex items-center gap-2 bg-accent/5 px-3 py-2">
				<span className="text-[10px] font-semibold uppercase tracking-[0.15em]">Notifications</span>
				<span className="text-[10px] text-muted-foreground tabular-nums">{count}</span>
			</div>
			<div
				role="listbox"
				aria-label="Notifications"
				aria-activedescendant={activeRowId}
				tabIndex={0}
				className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
			>
				{children}
			</div>
			<div className="flex items-center gap-3 bg-accent/5 px-3 py-2 text-xs text-muted-foreground">
				<span>j/k Move</span>
				<span>↵ Open</span>
				<span>e Dismiss</span>
				<span>esc Close</span>
			</div>
		</div>
	)
}

export function NotificationEmptyState() {
	return <p className="px-3 py-6 text-center text-xs text-muted-foreground">Nothing is waiting on you.</p>
}
