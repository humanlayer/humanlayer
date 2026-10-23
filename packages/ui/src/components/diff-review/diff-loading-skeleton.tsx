import type { DiffStyle } from '../diff-style-provider'

const widths = [38, 64, 52, 73, 46, 61, 32, 55]

/** Decorative code rows, using the same success/error tokens as Pierre diffs. */
export function DiffLoadingSkeleton({ diffStyle }: { diffStyle: DiffStyle }) {
	const sides = diffStyle === 'split' ? ['deletion', 'addition'] as const : ['unified'] as const
	return (
		<div role="status" className="w-full min-w-0 bg-background py-2" data-testid="diff-loading-skeleton">
			<span className="sr-only">Loading patch…</span>
			<div aria-hidden="true" className="flex motion-safe:animate-pulse">
				{sides.map((side) => (
					<div key={side} className="min-w-0 flex-1 border-border not-first:border-l">
						{widths.map((width, index) => {
							const changed = index >= 2 && index <= 5
							const addition = side === 'addition' || (side === 'unified' && index >= 4)
							const color = changed ? `var(--terminal-${addition ? 'success' : 'error'})` : 'var(--terminal-fg)'
							return (
								<div key={index} className="flex h-[22px] items-center gap-3 pr-4" style={{ color, backgroundColor: changed ? `color-mix(in srgb, ${color} 10%, transparent)` : undefined }}>
									<div className="flex h-full w-12 shrink-0 items-center justify-end border-r border-border/40 pr-2">
										<span className="h-2 w-3 rounded-sm bg-current opacity-15" />
									</div>
									<span className="w-2 shrink-0 font-mono text-xs opacity-60">{changed ? addition ? '+' : '−' : ''}</span>
									<span className="h-2 rounded-sm bg-current opacity-25" style={{ width: `${width}%`, marginLeft: index > 1 && index < 6 ? 12 : 0 }} />
								</div>
							)
						})}
					</div>
				))}
			</div>
		</div>
	)
}
