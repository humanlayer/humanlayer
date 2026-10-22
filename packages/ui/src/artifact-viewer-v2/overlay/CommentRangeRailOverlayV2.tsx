import type { Editor } from '@tiptap/react'
import { useMemo, useRef, useState } from 'react'

import { useMountEffect } from '../../hooks/use-mount-effect'
import {
	isArtifactCommentRootActive,
	useArtifactCommentFocusStore,
} from '../controller/transient-focus-store'
import { measureRangeExtent } from './range-extent'

/** One resolved inline comment range that needs a drawn right-edge rail. */
export interface CommentRangeRailV2 {
	/** Stable key, typically the root comment ID. */
	key: string
	/** Resolved inline range document positions. */
	from: number
	to: number
	/** Brighten while any of the range's threads is selected/hovered. */
	active: boolean
}

export interface CommentRangeRailOverlayV2Props {
	editor: Editor | null
	ranges: CommentRangeRailV2[]
}

interface RailSegment {
	key: string
	active: boolean
	top: number
	height: number
}

/** Matches the whole-block rail's `inset -2px` box-shadow width. */
const RAIL_WIDTH = 2

/**
 * Right-edge rail for precise inline comment ranges. A whole-block comment
 * already shows a right rail (the `inset -2px` box-shadow on its full-width
 * block node); an inline range only tints its text run, so this overlay draws
 * the matching rail — one contiguous bar spanning the range's full vertical
 * extent (first line top → last line bottom), pinned to the document column's
 * right edge beside the gutter avatar.
 *
 * A single unbroken bar (rather than one per wrapped line) keeps the rail
 * reading as one mark for the comment, with no line-leading gaps. The rail x is
 * the editor content column's right edge (where every block's rail lands), so a
 * short last line still draws flush at the column edge rather than at the end of
 * its text. Measurement mirrors the gutter overlay: pure DOM reads during
 * render, invalidated by a mount-scoped ResizeObserver / transaction listener —
 * the only external-system lifecycle here.
 */
export function CommentRangeRailOverlayV2({ editor, ranges }: CommentRangeRailOverlayV2Props) {
	if (!editor) return <div className="artifact-viewer-v2-comment-rail-overlay" aria-hidden />
	return <MountedCommentRangeRailOverlayV2 editor={editor} ranges={ranges} />
}

function MountedCommentRangeRailOverlayV2({
	editor,
	ranges,
}: {
	editor: Editor
	ranges: CommentRangeRailV2[]
}) {
	const overlayRef = useRef<HTMLDivElement | null>(null)
	const [layoutTick, setLayoutTick] = useState(0)
	useMountEffect(() => {
		let raf = 0
		const bump = () => {
			cancelAnimationFrame(raf)
			raf = requestAnimationFrame(() => setLayoutTick((tick) => tick + 1))
		}
		// React node views (code blocks) mount asynchronously; re-measure after
		// two frames to catch late layout, mirroring the gutter overlay.
		const deferred = requestAnimationFrame(() => requestAnimationFrame(bump))
		editor?.on('transaction', bump)
		const observer = new ResizeObserver(bump)
		if (overlayRef.current) observer.observe(overlayRef.current)
		return () => {
			cancelAnimationFrame(raf)
			cancelAnimationFrame(deferred)
			editor?.off('transaction', bump)
			observer.disconnect()
		}
	})

	const positioned = useMemo((): { left: number; segments: RailSegment[] } => {
		// layoutTick invalidates measurements after layout-affecting events.
		void layoutTick
		const view = editor?.view
		const overlayEl = overlayRef.current
		if (!view || !overlayEl) return { left: 0, segments: [] }
		const overlayRect = overlayEl.getBoundingClientRect()
		// The content column's right edge — where every block's rail sits — is the
		// editor root's border-box right, less its right padding/border.
		const rootEl = view.dom as HTMLElement
		const rootRect = rootEl.getBoundingClientRect()
		const rootStyle = getComputedStyle(rootEl)
		const columnRight =
			rootRect.right - parseFloat(rootStyle.paddingRight || '0') - parseFloat(rootStyle.borderRightWidth || '0')
		const left = columnRight - overlayRect.left - RAIL_WIDTH
		const segments: RailSegment[] = []
		for (const range of ranges) {
			const extent = measureRangeExtent(view, range.from, range.to)
			if (!extent) continue
			segments.push({
				key: range.key,
				active: range.active,
				top: extent.top - overlayRect.top,
				height: extent.bottom - extent.top,
			})
		}
		return { left, segments }
	}, [editor, ranges, layoutTick])

	return (
		<div ref={overlayRef} className="artifact-viewer-v2-comment-rail-overlay" aria-hidden>
			{positioned.segments.map((segment) => (
				<CommentRangeRailSegment key={segment.key} segment={segment} left={positioned.left} />
			))}
		</div>
	)
}

function CommentRangeRailSegment({ segment, left }: { segment: RailSegment; left: number }) {
	const focusActive = useArtifactCommentFocusStore((state) => isArtifactCommentRootActive(state, segment.key))
	return <CommentRangeRailSegmentPure segment={segment} left={left} active={segment.active || focusActive} />
}

function CommentRangeRailSegmentPure({ segment, left, active }: { segment: RailSegment; left: number; active: boolean }) {
	return (
		<div
			className={
				active
					? 'artifact-viewer-v2-comment-rail artifact-viewer-v2-comment-rail-active'
					: 'artifact-viewer-v2-comment-rail'
			}
			style={{ left, top: segment.top, height: segment.height }}
		/>
	)
}
