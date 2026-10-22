import { X } from 'lucide-react'
import { useId } from 'react'

export interface LauncherRecentDraft {
	id: string
	text: string
	timeLabel: string
}

export interface LauncherRecentDraftsProps {
	drafts: readonly LauncherRecentDraft[]
	visible: boolean
	disabled?: boolean
	onRestore: (draftId: string) => void
	onArchive: (draftId: string) => void
	onViewAll: () => void
}

/** Provider-free recent task draft list. */
export function LauncherRecentDrafts({
	drafts,
	visible,
	disabled = false,
	onRestore,
	onArchive,
	onViewAll,
}: LauncherRecentDraftsProps) {
	const headingId = useId()
	if (!visible || drafts.length === 0) return null

	return (
		<section aria-labelledby={headingId} data-launcher-recent-drafts className="mt-6">
			<h2
				id={headingId}
				className="mb-1 px-1 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
			>
				Recent drafts
			</h2>
			<ul aria-label="Recent task drafts" className="flex flex-col">
				{drafts.map((draft) => (
					<li
						key={draft.id}
						className="group flex items-center gap-2 border-b border-border/40 px-1 py-1.5 text-sm"
					>
						<button
							type="button"
							aria-label={`Restore draft ${draft.text}`}
							className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left hover:text-[var(--terminal-accent)]"
							disabled={disabled}
							onClick={() => onRestore(draft.id)}
						>
							<span className="min-w-0 flex-1 truncate">{draft.text}</span>
							{draft.timeLabel && (
								<span className="shrink-0 text-xs text-muted-foreground">{draft.timeLabel}</span>
							)}
						</button>
						<button
							type="button"
							aria-label={`Archive draft ${draft.text}`}
							className="shrink-0 cursor-pointer p-1 text-muted-foreground opacity-60 transition-opacity hover:text-foreground group-hover:opacity-100"
							disabled={disabled}
							onClick={() => onArchive(draft.id)}
						>
							<X aria-hidden className="size-3.5" />
						</button>
					</li>
				))}
			</ul>
			<div className="mt-2 px-1">
				<button
					type="button"
					className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
					disabled={disabled}
					onClick={onViewAll}
				>
					View all drafts
				</button>
			</div>
		</section>
	)
}
