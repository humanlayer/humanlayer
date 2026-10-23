import { useViewportFileDropTarget } from '@/hooks/useViewportFileDropTarget'

/** Shown while a file drag is over the window and a composer can take it; the drop lands anywhere. */
export function FileDropOverlay() {
	const dragging = useViewportFileDropTarget()
	if (!dragging) return null
	return (
		<div className="file-drop" aria-hidden="true">
			<span>Drop files to attach</span>
		</div>
	)
}
