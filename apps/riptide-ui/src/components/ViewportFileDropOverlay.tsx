import { useViewportFileDropTarget } from '@/hooks/useViewportFileDropTarget'

export function ViewportFileDropOverlay() {
	const isDragging = useViewportFileDropTarget()

	if (!isDragging) return null

	return (
		<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--terminal-accent)_10%,transparent)] p-4">
			<div className="flex h-full w-full items-center justify-center rounded-lg border-2 border-dashed border-[var(--terminal-accent)]">
				<span className="font-mono text-sm uppercase tracking-wider text-[var(--terminal-accent)]">
					Drop files here
				</span>
			</div>
		</div>
	)
}
