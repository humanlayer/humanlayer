import type { Editor } from '@tiptap/react'
import { useMemo, useRef, useState } from 'react'

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '../../components/avatar'
import { useMountEffect } from '../../hooks/use-mount-effect'
import { measureRangeExtent } from './range-extent'

export interface CommentGutterParticipantV2 {
	name: string
	avatarUrl: string
}

/** One gutter row: all root threads anchored to the same resolved block. */
export interface CommentGutterItemV2 {
	/** Absolute ProseMirror position of the commented block node. */
	blockPos: number
	/** Root comment IDs on this block, in rail display order. */
	rootCommentIds: string[]
	/** Unique thread participants across the block's threads. */
	participants: CommentGutterParticipantV2[]
	/**
	 * For precise-range items, the union document range of the block's threads.
	 * When present the avatar centers on the range's vertical midpoint (aligned
	 * with its rail); absent for whole-block items, which center on the block.
	 */
	anchorFrom?: number
	anchorTo?: number
}

/** Hover/click payload — the V1-compatible contract (ids + rect). */
export interface CommentGutterItemInfoV2 {
	blockPos: number
	rootCommentIds: string[]
	rect: DOMRect
}

export interface CommentGutterOverlayV2Props {
	editor: Editor | null
	items: CommentGutterItemV2[]
	/** Null clears the hover. */
	onItemHover: (info: CommentGutterItemInfoV2 | null) => void
	onItemClick: (info: CommentGutterItemInfoV2) => void
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map((word) => word[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

/**
 * Basic whole-block comment gutter for Artifact Viewer V2: participant
 * avatars (+N) pinned beside each commented block, with hover/click callbacks
 * matching the V1 gutter's contract shape. Intentionally small — the
 * hardening slice completes NodeView/layout edge cases without replacing this
 * API.
 *
 * Rendered inside a `position: relative` document layer; block tops are
 * measured against the overlay itself. Measurement happens during render
 * (pure DOM reads) and is invalidated by a mount-scoped ResizeObserver /
 * editor-transaction listener — the only external-system lifecycle here.
 */
export function CommentGutterOverlayV2({ editor, items, onItemHover, onItemClick }: CommentGutterOverlayV2Props) {
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
		// React node views (code blocks) mount asynchronously; re-measure after
		// two frames to catch late layout, mirroring the V1 overlay.
		const deferred = requestAnimationFrame(() => requestAnimationFrame(bump))
		const editorAtMount = latestRef.current.editor
		editorAtMount?.on('transaction', bump)
		// The overlay spans the document layer, so any content/viewport layout
		// change resizes it — this also covers an editor that finished mounting
		// after this effect ran.
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
		// layoutTick invalidates measurements after layout-affecting events.
		void layoutTick
		const view = editor?.view
		const overlayEl = overlayRef.current
		if (!view || !overlayEl) return []
		const overlayTop = overlayEl.getBoundingClientRect().top
		const result: Array<CommentGutterItemV2 & { top: number }> = []
		for (const item of items) {
			try {
				// A precise-range item centers on its range's vertical midpoint (so the
				// avatar lines up with its rail); a whole-block item centers on the block.
				if (item.anchorFrom != null && item.anchorTo != null) {
					const extent = measureRangeExtent(view, item.anchorFrom, item.anchorTo)
					if (extent) {
						result.push({ ...item, top: (extent.top + extent.bottom) / 2 - overlayTop })
						continue
					}
				}
				const dom = view.nodeDOM(item.blockPos)
				if (!(dom instanceof HTMLElement)) continue
				const rect = dom.getBoundingClientRect()
				result.push({ ...item, top: rect.top - overlayTop + rect.height / 2 })
			} catch {
				// Position may be stale while the document changes.
			}
		}
		return result
	}, [editor, items, layoutTick])

	return (
		<div ref={overlayRef} className="artifact-viewer-v2-comment-gutter" aria-hidden={positioned.length === 0}>
			{positioned.map((item) => (
				<div
					key={item.rootCommentIds.join(',')}
					className="artifact-viewer-v2-comment-gutter-item"
					style={{ top: item.top }}
					onMouseEnter={(event) =>
						onItemHover({
							blockPos: item.blockPos,
							rootCommentIds: item.rootCommentIds,
							rect: event.currentTarget.getBoundingClientRect(),
						})
					}
					onMouseLeave={() => onItemHover(null)}
					onClick={(event) =>
						onItemClick({
							blockPos: item.blockPos,
							rootCommentIds: item.rootCommentIds,
							rect: event.currentTarget.getBoundingClientRect(),
						})
					}
				>
					<AvatarGroup className="*:data-[slot=avatar]:ring-0">
						{item.participants.slice(0, 3).map((participant) => (
							<Avatar key={participant.name} className="size-5">
								<AvatarImage src={participant.avatarUrl} alt={participant.name} />
								<AvatarFallback className="text-[9px]">{getInitials(participant.name)}</AvatarFallback>
							</Avatar>
						))}
						{item.participants.length > 3 && (
							<AvatarGroupCount className="size-5 text-[9px]">+{item.participants.length - 3}</AvatarGroupCount>
						)}
					</AvatarGroup>
				</div>
			))}
		</div>
	)
}
