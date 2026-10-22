export interface ReviewProgressProps {
	reviewed: number
	total: number
	className?: string
}

export function ReviewProgress({ reviewed, total, className }: ReviewProgressProps) {
	const progress = total === 0 ? 0 : Math.min(100, Math.round((reviewed / total) * 100))

	return (
		<div className={className} aria-label={`${reviewed} of ${total} changed lines reviewed`}>
			<span className="block h-2 w-full overflow-hidden bg-muted ring-1 ring-border" aria-hidden="true">
				<span className="block h-full bg-[var(--terminal-success)] transition-[width]" style={{ width: `${progress}%` }} />
			</span>
		</div>
	)
}
