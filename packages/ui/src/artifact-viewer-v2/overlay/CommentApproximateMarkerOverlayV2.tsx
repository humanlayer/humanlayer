import type { Editor } from '@tiptap/react'
import { MessageSquareDashed } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'

import { useMountEffect } from '../../hooks/use-mount-effect'

/** One best-effort marker: Outdated threads whose saved neighbors place them at a block edge. */
export interface CommentApproximateMarkerV2 {
	key: string
	/** Absolute ProseMirror position of the surviving neighbor block. */
	blockPos: number
	edge: 'after' | 'before'
	rootCommentIds: string[]
}

export interface CommentApproximateMarkerOverlayV2Props {
	editor: Editor | null
	markers: CommentApproximateMarkerV2[]
	onMarkerClick: (rootCommentIds: string[]) => void
}

/** Root IDs on a marker element, space-separated for `~=` attribute lookups. */
export const APPROXIMATE_MARKER_ROOT_IDS_ATTRIBUTE = 'data-approximate-root-ids'

/**
 * Dashed boundary markers for Outdated comments placed from surviving neighbor
 * text. Each marker spans the neighbor block's width at its top or bottom edge
 * and never tints document text, so an approximate location never reads as an
 * exact highlight. Measured the same way as the gutter overlay.
 */
export function CommentApproximateMarkerOverlayV2({
	editor,
	markers,
	onMarkerClick,
}: CommentApproximateMarkerOverlayV2Props) {
	const overlayRef = useRef<HTMLDivElement | null>(null)
	const [layoutTick, setLayoutTick] = useState(0)
	const latestRef = useRef({ editor })
	latestRef.current = { editor }

	useMountEffect(() => {
		let raf = 0
		const bump = () => {
			cancelAnimationFrame(raf)
			raf = requestAnimationFrame(() => setLayoutTick((tick) => tick + 1))
		}
		const deferred = requestAnimationFrame(() => requestAnimationFrame(bump))
		const editorAtMount = latestRef.current.editor
		editorAtMount?.on('transaction', bump)
		const observer = new ResizeObserver(bump)
		if (overlayRef.current) observer.observe(overlayRef.current)
		return () => {
			cancelAnimationFrame(raf)
			cancelAnimationFrame(deferred)
			editorAtMount?.off('transaction', bump)
			observer.disconnect()
		}
	})

	const positioned = useMemo(() => {
		void layoutTick
		const view = editor?.view
		const overlayEl = overlayRef.current
		if (!view || !overlayEl) return []
		const overlayRect = overlayEl.getBoundingClientRect()
		const result: Array<CommentApproximateMarkerV2 & { top: number; left: number; width: number }> = []
		for (const marker of markers) {
			try {
				const dom = view.nodeDOM(marker.blockPos)
				if (!(dom instanceof HTMLElement)) continue
				const rect = dom.getBoundingClientRect()
				result.push({
					...marker,
					top: (marker.edge === 'after' ? rect.bottom : rect.top) - overlayRect.top,
					left: rect.left - overlayRect.left,
					width: rect.width,
				})
			} catch {
				// Position may be stale while the document changes.
			}
		}
		return result
	}, [editor, markers, layoutTick])

	return (
		<div ref={overlayRef} className="artifact-viewer-v2-approximate-marker-overlay">
			{positioned.map((marker) => {
				const count = marker.rootCommentIds.length
				const label = count === 1 ? 'Show outdated comment' : `Show ${count} outdated comments`
				return (
					<div
						key={marker.key}
						className="artifact-viewer-v2-approximate-marker"
						style={{ top: marker.top, left: marker.left, width: marker.width }}
						{...{ [APPROXIMATE_MARKER_ROOT_IDS_ATTRIBUTE]: marker.rootCommentIds.join(' ') }}
					>
						<button
							type="button"
							className="artifact-viewer-v2-approximate-marker-pill"
							aria-label={label}
							title="The text this comment was on changed. It was about here."
							onClick={() => onMarkerClick(marker.rootCommentIds)}
						>
							<MessageSquareDashed className="size-3" />
							{count > 1 ? <span>{count}</span> : null}
						</button>
					</div>
				)
			})}
		</div>
	)
}
