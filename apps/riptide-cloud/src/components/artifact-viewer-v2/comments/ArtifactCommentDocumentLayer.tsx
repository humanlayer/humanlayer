import {
	CommentApproximateMarkerOverlayV2,
	CommentGutterOverlayV2,
	CommentRangeRailOverlayV2,
	decideDocumentReviewClick,
	deriveDocumentReviewFacts,
	type CommentGutterItemInfoV2,
	type CommentHighlightRange,
	type Editor,
	type NavigableBlock,
	type ProjectedCommentThread,
} from '@humanlayer/ui/artifact-viewer-v2'
import { useMemo, type MouseEvent, type ReactNode } from 'react'

export interface ArtifactCommentDocumentLayerProps {
	editor: Editor | null
	blocks: NavigableBlock[]
	threads: ProjectedCommentThread[]
	highlights: CommentHighlightRange[]
	activateThread: (rootId: string, options: { reveal: 'rail' | 'document' }) => void
	hoverThread: (rootId: string | null) => void
	requestCompose: (block: NavigableBlock) => void
	children: ReactNode
}

const EMPTY_ACTIVE_ROOT_IDS: ReadonlySet<string> = new Set()

export function ArtifactCommentDocumentLayer({
	editor,
	blocks,
	threads,
	highlights,
	activateThread,
	hoverThread,
	requestCompose,
	children,
}: ArtifactCommentDocumentLayerProps) {
	const { gutterItems, railRanges, approximateMarkers } = useMemo(
		() => deriveDocumentReviewFacts(threads, blocks, EMPTY_ACTIVE_ROOT_IDS),
		[threads, blocks],
	)

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		const view = editor?.view
		if (!view) return
		if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
		const target = event.target instanceof Element ? event.target : null
		if (
			target?.closest(
				'.artifact-viewer-v2-heading-disclosure, .artifact-viewer-v2-comment-gutter-item, .artifact-viewer-v2-approximate-marker-pill',
			)
		) {
			return
		}
		if (window.getSelection()?.isCollapsed === false) return
		const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
		if (!coords) return
		const decision = decideDocumentReviewClick(coords.pos, blocks, highlights)
		if (decision.kind === 'activate') activateThread(decision.rootCommentId, { reveal: 'rail' })
		else if (decision.kind === 'target-block') requestCompose(decision.block)
	}

	const handleGutterHover = (info: CommentGutterItemInfoV2 | null) => hoverThread(info?.rootCommentIds[0] ?? null)
	const handleGutterClick = (info: CommentGutterItemInfoV2) => {
		const rootId = info.rootCommentIds[0]
		if (rootId) activateThread(rootId, { reveal: 'rail' })
	}

	return (
		<div className="artifact-viewer-v2-comment-layer" onClick={handleClick}>
			{children}
			<CommentRangeRailOverlayV2 editor={editor} ranges={railRanges} />
			<CommentApproximateMarkerOverlayV2
				editor={editor}
				markers={approximateMarkers}
				onMarkerClick={(rootIds) => {
					const rootId = rootIds[0]
					if (rootId) activateThread(rootId, { reveal: 'rail' })
				}}
			/>
			<CommentGutterOverlayV2
				editor={editor}
				items={gutterItems}
				onItemHover={handleGutterHover}
				onItemClick={handleGutterClick}
			/>
		</div>
	)
}
