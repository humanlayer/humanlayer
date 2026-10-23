import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import type { ArtifactPresentationHandle } from '@humanlayer/ui/artifact-viewer-v2'
import {
	ArtifactCommentPanel,
	type ArtifactCommentPanelHandle,
	NEW_COMMENT_KEY,
	useCommentThreads,
} from '@humanlayer/ui/components/artifact-comment-panel'
import { ArtifactViewer, type ArtifactViewerProps } from '@humanlayer/ui/components/artifact-viewer'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import { partitionCommentRowsByRootFormat } from '@humanlayer/ui/lib/artifact-comment-format'
import { getCommentColorForUser } from '@humanlayer/ui/lib/comment-utils'
import { type MatchableBlock, matchCommentToBlock } from '@humanlayer/ui/markdown-viewer/comment-matching'
import type { CommentBlockHoverInfo, CommentClickInfo } from '@humanlayer/ui/markdown-viewer/CommentGutter'
import { setPendingHighlightBlock } from '@humanlayer/ui/markdown-viewer/CommentGutter'
import type { GutterItemInfo } from '@humanlayer/ui/markdown-viewer/CommentGutterOverlay'
import type { CommentData } from '@humanlayer/ui/markdown-viewer/MarkdownViewer'
import { eq, useLiveQuery } from '@tanstack/react-db'
import type { JSONContent } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import type { MutableRefObject } from 'react'
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ArtifactViewerV2 } from '@/components/artifact-viewer-v2/ArtifactViewerV2'
import type { ArtifactVersionDiffView } from '@/components/artifact-viewer-v2/useArtifactVersions'
import { useSyncedArtifactReview } from '@/components/artifact-viewer-v2/useSyncedArtifactReview'
import { riptideLanguageRenderers } from '@/components/markdown-viewer/language-renderers'
import { useSync } from '@/components/providers/SyncProvider'
import { WiredCommentThread } from '@/components/WiredCommentThread'
import { WiredNewCommentForm } from '@/components/WiredNewCommentForm'
import { useHoverCardStore } from '@/hooks/stores/hoverCardStore'
import { useDiffFullscreenDialogOpen } from '@/hooks/stores/taskDiffReviewStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { SentryErrorBoundary } from '@/integrations/sentry/SentryErrorBoundary'
import type { WiredArtifactViewerMode } from '@/lib/artifact-viewer-mode'

type CommentRelatedProps =
	| 'comments'
	| 'blockComments'
	| 'onCommentClick'
	| 'onBlockClick'
	| 'onSelectionChange'
	| 'commentedLines'
	| 'onLineClick'
	| 'onGutterItemClick'
	| 'onGutterItemHover'

export interface WiredArtifactViewerProps extends Omit<ArtifactViewerProps, CommentRelatedProps> {
	presentationHandleRef?: MutableRefObject<ArtifactPresentationHandle | null>
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
	mode: WiredArtifactViewerMode
	displayMode: 'sidebar' | 'fullscreen'
	/** When set, scroll the artifact viewer to highlight this comment after render */
	pendingScrollCommentId?: string | null
	onScrollComplete?: () => void
	/** Returns true while a recent programmatic scroll is suppressing mouse-driven hover events.
	 *  Same pattern as the conversation stream's keyboard-nav protection. */
	shouldIgnoreMouseEvent: () => boolean
	versionDiff?: ArtifactVersionDiffView
}

interface UserInfo {
	displayName?: string
	avatarUrl?: string
}

/** Wired Markdown review boundary. Viewer selection happens in ArtifactViewerSurface. */
export function WiredArtifactViewer(props: WiredArtifactViewerProps) {
	if (props.mode.kind === 'review') return <WiredReviewArtifactViewer {...props} />
	return <WiredLegacyArtifactViewer {...props} />
}

function WiredReviewArtifactViewer(props: WiredArtifactViewerProps) {
	const review = useSyncedArtifactReview({
		artifactId: props.artifactId,
		taskId: props.taskId,
		resourceOwnerUserId: props.resourceOwnerUserId,
	})
	const viewMode = props.tabValue ?? props.defaultView ?? 'rendered'
	return (
		<ArtifactViewerV2
			presentationHandleRef={props.presentationHandleRef}
			artifactId={props.artifactId}
			review={review}
			content={props.content}
			fileName={props.fileName ?? 'artifact.md'}
			displayMode={props.displayMode}
			viewMode={viewMode}
			onViewModeChange={props.onTabValueChange ?? (() => {})}
			externalEditorRef={props.editorRef}
			searchQuery={props.searchQuery}
			searchCurrentMatch={props.searchCurrentMatch}
			searchEnabled={props.searchEnabled}
			onSearchToggleRequest={props.onSearchToggleRequest}
			hideHeader={props.hideHeader}
			actionsMenu={props.actionsMenu}
			versionDiff={props.versionDiff}
		>
			{props.children}
		</ArtifactViewerV2>
	)
}

function WiredLegacyArtifactViewer({
	presentationHandleRef: _presentationHandleRef,
	artifactId,
	taskId,
	resourceOwnerUserId,
	displayMode,
	pendingScrollCommentId,
	onScrollComplete,
	editorRef: externalEditorRef,
	versionDiff: _versionDiff,
	shouldIgnoreMouseEvent,
	mode: _mode,
	...viewerProps
}: WiredArtifactViewerProps) {
	const { artifactCommentsCollection } = useSync()
	const diffFullscreenOpen = useDiffFullscreenDialogOpen()
	const { membersMap } = useOrgMembers()

	// Build user lookup for comment components
	const userLookup = useMemo(() => {
		const map = new Map<string, UserInfo>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
				avatarUrl: member.profilePictureUrl,
			})
		}
		return map
	}, [membersMap])

	// Live query: comments for this artifact
	const commentsQuery = useLiveQuery(
		(q) =>
			q
				.from({ comments: artifactCommentsCollection })
				.where(({ comments }) => eq(comments.artifact_id, artifactId)),
		[artifactCommentsCollection, artifactId],
	)
	const rawComments: ArtifactComment[] = (commentsQuery.data ?? []) as ArtifactComment[]
	// V1 adapter boundary: consume only the legacy side of the whole-thread
	// partition. V2-anchored roots (and their replies) must never render as V1
	// general comments or enter V1 counts/threads.
	const allComments = useMemo(() => partitionCommentRowsByRootFormat(rawComments).legacy, [rawComments])

	// Transform DB comments → CommentData[] for MarkdownViewer
	const commentData: CommentData[] = useMemo(() => {
		return allComments
			.filter((c) => !c.is_deleted && !c.is_resolved && c.commented_upon_block_text != null)
			.map((c) => {
				const user = userLookup.get(c.created_by_user_id)
				const replyAuthorIds = allComments
					.filter((r) => !r.is_deleted && r.reply_to_comment_id === c.id)
					.map((r) => r.created_by_user_id)
				const uniqueIds = [...new Set([c.created_by_user_id, ...replyAuthorIds])]
				const participants = uniqueIds.map((uid) => {
					const u = userLookup.get(uid)
					return { name: u?.displayName ?? 'Unknown', avatarUrl: u?.avatarUrl ?? '' }
				})
				return {
					commentId: c.id,
					authorName: user?.displayName ?? 'Unknown',
					authorAvatarUrl: user?.avatarUrl ?? '',
					participants,
					color: getCommentColorForUser(c.created_by_user_id),
					commentedUponBlockText: c.commented_upon_block_text ?? '',
					previousBlockText: c.previous_block_text,
					nextBlockText: c.next_block_text,
				}
			})
	}, [allComments, userLookup])

	// Selection state for creating new comments (context-based anchoring)
	const [pendingCommentAnchor, setPendingCommentAnchor] = useState<{
		commentedUponBlockText: string
		previousBlockText: string | null
		nextBlockText: string | null
	} | null>(null)
	const [selectionRect, setSelectionRect] = useState<DOMRect | null>(null)

	// Gutter interaction state (hover-only, no click popover) — shared across all instances via store
	const activeGutterInfo = useHoverCardStore((s) => s.activeGutterInfo)
	const { showHoverCard, scheduleHide, keepAlive, hideNow } = useHoverCardStore()

	// Comment panel ref for fullscreen mode + external forwarding
	const commentPanelRef = useRef<ArtifactCommentPanelHandle | null>(null)
	// Artifact viewer container ref for scoped comment scroll targeting and fullscreen positions
	const artifactContainerRef = useRef<HTMLDivElement>(null)
	const commentPanelCallbackRef = useCallback((handle: ArtifactCommentPanelHandle | null) => {
		commentPanelRef.current = handle
	}, [])
	// Scroll to a specific comment by DOM query when pendingScrollCommentId is set
	useEffect(() => {
		if (!pendingScrollCommentId) return

		// Find the root comment ID — the pendingScrollCommentId might be a reply
		let targetCommentId = pendingScrollCommentId
		const replyComment = allComments.find((c) => c.id === pendingScrollCommentId && c.reply_to_comment_id)
		if (replyComment?.reply_to_comment_id) {
			targetCommentId = replyComment.reply_to_comment_id
		}

		const findCommentTargetElement = () => {
			const container = artifactContainerRef.current
			const highlightedComment = container?.querySelector(
				`[data-comment-id="${CSS.escape(targetCommentId)}"]`,
			) as HTMLElement | null
			if (highlightedComment) return highlightedComment

			const comment = allComments.find((c) => c.id === targetCommentId)
			const editor = editorRef.current
			if (!comment?.commented_upon_block_text || !editor?.view) return null

			const blocks: MatchableBlock[] = []
			editor.state.doc.descendants(
				(
					node: { isTextblock?: boolean; textContent?: string; type?: { name?: string }; nodeSize?: number },
					pos: number,
				) => {
					if (!node.isTextblock) return
					blocks.push({
						pos,
						text: node.textContent ?? '',
						nodeType: node.type?.name ?? '',
						nodeSize: node.nodeSize ?? 0,
					})
				},
			)

			const bestIdx = matchCommentToBlock(blocks, {
				commentedUponBlockText: comment.commented_upon_block_text,
				previousBlockText: comment.previous_block_text,
				nextBlockText: comment.next_block_text,
			})

			if (bestIdx === -1) return null
			const bestBlock = blocks[bestIdx]
			if (bestBlock === undefined) return null
			return editor.view.nodeDOM(bestBlock.pos) as HTMLElement | null
		}

		// Delay to allow the editor to render comment marks
		let attempts = 0
		let timer: ReturnType<typeof setTimeout> | undefined
		const scrollToComment = () => {
			const el = findCommentTargetElement()
			if (el) {
				el.scrollIntoView({ behavior: 'smooth', block: 'center' })
				onScrollComplete?.()
				return
			}
			attempts += 1
			if (attempts >= 10) {
				onScrollComplete?.()
				return
			}
			timer = setTimeout(scrollToComment, 100)
		}
		timer = setTimeout(scrollToComment, 300)

		return () => {
			if (timer) clearTimeout(timer)
		}
	}, [pendingScrollCommentId, allComments, onScrollComplete])

	// Comment panel container ref for scroll sync
	const commentPanelContainerRef = useRef<HTMLDivElement>(null)
	const internalEditorRef = useRef<Editor | null>(null)
	const editorRef = externalEditorRef ?? internalEditorRef
	const lastBlockAnchorRef = useRef<{
		blockPos: number
		nodeType: string
		textPreview: string
	} | null>(null)

	// Line positions for comment panel (lineNumber → Y offset)
	const [linePositions, setLinePositions] = useState<Map<number, number>>(new Map())
	// Computed line numbers for comments that have highlighted_text but no stored line number
	const [computedLineNumbers, setComputedLineNumbers] = useState<Map<string, number>>(new Map())
	const { inlineThreadsFlat, generalThreads } = useCommentThreads(allComments, computedLineNumbers)
	const panelThreads = useMemo(
		() => [
			...inlineThreadsFlat.map((thread) => ({ thread, isOutdated: false })),
			...generalThreads
				.filter((thread) => thread.root.commented_upon_block_text != null)
				.map((thread) => ({ thread, isOutdated: true })),
		],
		[generalThreads, inlineThreadsFlat],
	)
	// Hovered comment IDs for fullscreen mode sidebar highlighting
	const [hoveredCommentIds, setHoveredCommentIds] = useState<string[]>([])
	const fullscreenHoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Block matching: compute which comments have matches in the doc (all display modes)
	// Y-position computation only needed for fullscreen panel layout
	useEffect(() => {
		const editor = editorRef.current
		if (!editor?.view) return

		const computeMatches = () => {
			const newPositions = new Map<number, number>()
			const newComputedLineNumbers = new Map<string, number>()

			const doc = editor.state.doc

			// Collect all textblocks with their context. This site keeps `pos: pos + 1`
			// and a 1-based `idx` as its downstream position basis (coordsAtPos / line
			// number); the shared matcher only needs `text` + context for matching.
			const blocks: MatchableBlock[] = []
			const idxByBlock: number[] = []
			let blockIdx = 0
			doc.descendants((node, pos) => {
				if (!node.isTextblock) return
				blockIdx++
				blocks.push({
					pos: pos + 1,
					text: node.textContent,
					nodeType: node.type?.name ?? '',
					nodeSize: node.nodeSize ?? 0,
				})
				idxByBlock.push(blockIdx)
			})

			for (const comment of allComments) {
				if (comment.is_deleted || !comment.commented_upon_block_text) continue

				// Context-based matching via the shared helper.
				const bestBlockIdx = matchCommentToBlock(blocks, {
					commentedUponBlockText: comment.commented_upon_block_text,
					previousBlockText: comment.previous_block_text,
					nextBlockText: comment.next_block_text,
				})

				if (bestBlockIdx === -1) continue

				const best = blocks[bestBlockIdx]
				const effectiveLineNumber = idxByBlock[bestBlockIdx]
				if (best === undefined || effectiveLineNumber === undefined) continue

				newComputedLineNumbers.set(comment.id, effectiveLineNumber)

				// Y-position only needed for fullscreen panel layout
				if (displayMode === 'fullscreen') {
					const containerEl = artifactContainerRef.current
					if (containerEl) {
						try {
							const coords = editor.view.coordsAtPos(best.pos)
							const containerRect = containerEl.getBoundingClientRect()
							const scrollTop = containerEl.scrollTop
							const y = coords.top - containerRect.top + scrollTop
							newPositions.set(effectiveLineNumber, y)
						} catch {
							// Position might be invalid
						}
					}
				}
			}

			setLinePositions(newPositions)
			setComputedLineNumbers(newComputedLineNumbers)
		}

		// Compute on mount and when comments change
		computeMatches()

		// Also recompute on editor transactions (content changes) and resize
		const onUpdate = () => requestAnimationFrame(computeMatches)
		editor.on('transaction', onUpdate)

		const observer = new ResizeObserver(onUpdate)
		if (artifactContainerRef.current) {
			observer.observe(artifactContainerRef.current)
		}

		return () => {
			editor.off('transaction', onUpdate)
			observer.disconnect()
		}
	}, [allComments, displayMode, viewerProps.tabValue])

	const handleBlockClick = useCallback(
		(info: {
			blockPos: number
			nodeType: string
			textContent: string
			previousBlockText: string | null
			nextBlockText: string | null
			rect: DOMRect
		}) => {
			if (!info.textContent) return // Ignore clicks on empty blocks
			// Dismiss any active hover card when opening the new comment form
			hideNow()
			const textPreview = info.textContent.replace(/\s+/g, ' ').trim().slice(0, 160)
			lastBlockAnchorRef.current = {
				blockPos: info.blockPos,
				nodeType: info.nodeType,
				textPreview,
			}
			if (editorRef.current?.view) {
				setPendingHighlightBlock(editorRef.current.view, info.blockPos)
			}
			setPendingCommentAnchor({
				commentedUponBlockText: info.textContent,
				previousBlockText: info.previousBlockText,
				nextBlockText: info.nextBlockText,
			})
			setSelectionRect(info.rect)
		},
		[hideNow],
	)

	// Hover handler for gutter items — shows interactive thread on hover
	const handleGutterItemHover = useCallback(
		(info: GutterItemInfo | null) => {
			if (info) {
				// Suppress hovers triggered by content shifting under a stationary cursor
				// (e.g. artifact search auto-scroll). Cursor-move mouseovers still pass through
				// — the predicate only returns true for a brief window after a programmatic scroll.
				if (shouldIgnoreMouseEvent()) return
				showHoverCard(info)
			} else {
				scheduleHide()
			}
		},
		[showHoverCard, scheduleHide, shouldIgnoreMouseEvent],
	)

	// Keep the card visible when mouse enters it
	const handleCardMouseEnter = useCallback(() => {
		keepAlive()
	}, [keepAlive])

	const handleCardMouseLeave = useCallback(() => {
		scheduleHide()
	}, [scheduleHide])

	// Hover handler for comment block highlights
	const handleCommentBlockHover = useCallback(
		(info: CommentBlockHoverInfo | null) => {
			if (displayMode === 'fullscreen') {
				if (fullscreenHoverTimeoutRef.current) clearTimeout(fullscreenHoverTimeoutRef.current)
				// Fullscreen: highlight comment cards in sidebar
				if (info) {
					fullscreenHoverTimeoutRef.current = setTimeout(() => {
						setHoveredCommentIds(info.comments.map((c) => c.commentId))
					}, 100)
				} else {
					fullscreenHoverTimeoutRef.current = setTimeout(() => {
						setHoveredCommentIds([])
					}, 200)
				}
			} else {
				// Non-fullscreen: show hover card (same as gutter hover)
				if (info) {
					if (shouldIgnoreMouseEvent()) return
					// Convert CommentBlockHoverInfo to GutterItemInfo-like shape
					const gutterInfo: GutterItemInfo = {
						lineNumber: 0,
						comments: info.comments,
						rect: info.rect,
					}
					showHoverCard(gutterInfo)
				} else {
					scheduleHide()
				}
			}
		},
		[displayMode, showHoverCard, scheduleHide, shouldIgnoreMouseEvent],
	)

	const handleCancelHighlight = useCallback(() => {
		if (editorRef.current?.view) {
			setPendingHighlightBlock(editorRef.current.view, null)
		}
		setPendingCommentAnchor(null)
		setSelectionRect(null)
	}, [])

	/**
	 * Stable callback to resolve markdown for a comment's block context.
	 * Called lazily (on "Copy for LLM" click) to avoid memoization issues.
	 */
	const getMarkdownContextForComment = useCallback(
		(
			commentId: string,
		): { previousMarkdown: string | null; currentMarkdown: string | null; nextMarkdown: string | null } | null => {
			const editor = editorRef.current
			if (!editor?.view) return null
			const markdownManager = editor.markdown
			if (!markdownManager) return null

			const comment = allComments.find((c) => c.id === commentId)
			if (!comment?.commented_upon_block_text) return null

			const doc = editor.state.doc
			const blocks: { text: string; json: JSONContent }[] = []
			doc.descendants((node) => {
				if (!node.isTextblock) return
				blocks.push({ text: node.textContent, json: node.toJSON() as JSONContent })
			})

			// Find matched block using context scoring (same as applyComments)
			let bestIdx = -1
			let bestScore = 0
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i]
				if (block === undefined) continue
				if (block.text !== comment.commented_upon_block_text) continue
				let score = 1
				const prevText = i > 0 ? (blocks[i - 1]?.text ?? null) : null
				if (comment.previous_block_text === prevText) score += 2
				else if (comment.previous_block_text === null && prevText === null) score += 2
				const nextText = i < blocks.length - 1 ? (blocks[i + 1]?.text ?? null) : null
				if (comment.next_block_text === nextText) score += 2
				else if (comment.next_block_text === null && nextText === null) score += 2
				if (score > bestScore) {
					bestScore = score
					bestIdx = i
				}
			}

			if (bestIdx === -1) return null

			const serializeBlock = (idx: number): string | null => {
				if (idx < 0 || idx >= blocks.length) return null
				const block = blocks[idx]
				if (block === undefined) return null
				try {
					return markdownManager.serialize(block.json)
				} catch {
					return null
				}
			}

			return {
				previousMarkdown: serializeBlock(bestIdx - 1),
				currentMarkdown: serializeBlock(bestIdx),
				nextMarkdown: serializeBlock(bestIdx + 1),
			}
		},
		[allComments],
	)

	const [commentPanelHeight, setCommentPanelHeight] = useState(0)

	useMountEffect(() => {
		const el = commentPanelContainerRef.current
		if (!el) return
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0]
			if (entry === undefined) return
			setCommentPanelHeight(entry.contentRect.height)
		})
		ro.observe(el)
		return () => ro.disconnect()
	})

	// Sidebar mode: hover thread from gutter avatars
	// Must be a useMemo to properly react to allComments changes (e.g., after resolve)
	const activeThread = useMemo(() => {
		if (!activeGutterInfo) return null
		const commentIds = activeGutterInfo.comments.map((c) => c.commentId)
		const idSet = new Set(commentIds)
		const rootComments = allComments.filter((c) => !c.is_deleted && idSet.has(c.id) && !c.reply_to_comment_id)
		if (rootComments.length === 0) return null
		const root = rootComments[0]
		if (root === undefined) return null
		const replies = allComments.filter((c) => !c.is_deleted && c.reply_to_comment_id === root.id)
		return { root, replies }
	}, [activeGutterInfo, allComments])

	const focusCommentThread = useCallback(
		(commentIds: string[], fallbackLineNumber?: number) => {
			if (displayMode !== 'fullscreen') return
			hideNow()

			const primaryCommentId = commentIds[0]
			if (primaryCommentId) {
				commentPanelRef.current?.focusCommentById(primaryCommentId, {
					scroll: true,
					highlight: true,
					focusEditor: true,
				})
				return
			}

			if (fallbackLineNumber != null) {
				commentPanelRef.current?.focusThread(fallbackLineNumber, {
					scroll: true,
					highlight: true,
					focusEditor: true,
				})
			}
		},
		[displayMode, hideNow],
	)

	// Click handler for gutter items — focuses the reply editor in the comment panel
	const handleGutterItemClick = useCallback(
		(info: GutterItemInfo) => {
			focusCommentThread(
				info.comments.map((comment) => comment.commentId),
				info.lineNumber,
			)
		},
		[focusCommentThread],
	)

	const handleCommentClick = useCallback(
		(info: CommentClickInfo) => {
			if (displayMode !== 'fullscreen') {
				hideNow()
				setPendingCommentAnchor(null)
				setSelectionRect(null)
				if (editorRef.current?.view) {
					setPendingHighlightBlock(editorRef.current.view, null)
				}
				showHoverCard({
					lineNumber: info.lineNumber,
					comments: info.comments,
					rect: info.rect,
				})
				return
			}

			focusCommentThread(
				info.comments.map((comment) => comment.commentId),
				info.lineNumber,
			)
		},
		[displayMode, editorRef, focusCommentThread, hideNow, showHoverCard],
	)

	const handleArtifactChromeClick = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			if (displayMode !== 'fullscreen') return
			const target = event.target as HTMLElement | null
			if (!target) return
			if (target.closest('.comment-gutter-item')) return
			if (target.closest('.has-comments')) return
			const tiptapRoot = target.closest('.tiptap')
			if (tiptapRoot && target !== tiptapRoot) return
			commentPanelRef.current?.clearFocus()
		},
		[displayMode],
	)

	if (displayMode === 'fullscreen') {
		// Compute newCommentY relative to the artifact container's scroll position
		let newCommentY: number | undefined
		if (selectionRect && artifactContainerRef.current) {
			const containerRect = artifactContainerRef.current.getBoundingClientRect()
			const scrollTop = artifactContainerRef.current.scrollTop
			// Y position = selection top relative to container top + scroll offset
			newCommentY = selectionRect.top - containerRect.top + scrollTop
		} else if (pendingCommentAnchor) {
			// Fallback: position at top if we don't have rect info
			newCommentY = 0
		}

		return (
			<ResizablePanelGroup
				orientation="horizontal"
				disabled={diffFullscreenOpen}
				className="h-auto w-full overflow-visible"
				style={{ height: 'auto', overflow: 'visible' }}
			>
				<ResizablePanel id="artifact" defaultSize="65%" minSize="40%" style={{ overflow: 'visible' }}>
					<div ref={artifactContainerRef} onClick={handleArtifactChromeClick}>
						<SentryErrorBoundary variant="artifact" componentName="ArtifactViewer">
							<ArtifactViewer
								key={`${artifactId}-${viewerProps.tabValue ?? 'rendered'}`}
								{...viewerProps}
								comments={commentData}
								onCommentClick={handleCommentClick}
								onBlockClick={handleBlockClick}
								onGutterItemHover={handleGutterItemHover}
								onGutterItemClick={handleGutterItemClick}
								onCommentBlockHover={handleCommentBlockHover}
								editorRef={editorRef}
								customLanguageRenderers={riptideLanguageRenderers}
							/>
						</SentryErrorBoundary>
					</div>
				</ResizablePanel>

				<ResizableHandle
					withHandle
					className="sticky top-0 h-[calc(100vh-49px)] self-start border-l border-border"
				/>

				<ResizablePanel
					id="comments"
					defaultSize="35%"
					minSize="20%"
					maxSize="60%"
					style={{ overflow: 'visible' }}
				>
					<div ref={commentPanelContainerRef} className="p-3">
						<ArtifactCommentPanel
							ref={commentPanelCallbackRef}
							comments={allComments}
							linePositions={linePositions}
							computedLineNumbers={computedLineNumbers}
							newCommentY={newCommentY}
							containerHeight={commentPanelHeight}
							highlightedCommentIds={hoveredCommentIds}
						>
							{panelThreads.map(({ thread, isOutdated }) => (
								<WiredCommentThread
									key={thread.root.id}
									thread={thread}
									artifactFilename={viewerProps.fileName}
									getMarkdownContextForComment={getMarkdownContextForComment}
									isOutdated={isOutdated}
								/>
							))}
							{pendingCommentAnchor ? (
								<WiredNewCommentForm
									key={NEW_COMMENT_KEY}
									artifactId={artifactId}
									taskId={taskId}
									resourceOwnerUserId={resourceOwnerUserId}
									anchor={pendingCommentAnchor}
									onClose={handleCancelHighlight}
								/>
							) : null}
						</ArtifactCommentPanel>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		)
	}

	return (
		<div ref={artifactContainerRef} className="relative overflow-x-hidden">
			<SentryErrorBoundary variant="artifact" componentName="ArtifactViewer">
				<ArtifactViewer
					key={`${artifactId}-${viewerProps.tabValue ?? 'rendered'}`}
					{...viewerProps}
					comments={commentData}
					onCommentClick={handleCommentClick}
					onBlockClick={handleBlockClick}
					onGutterItemHover={handleGutterItemHover}
					onCommentBlockHover={handleCommentBlockHover}
					editorRef={editorRef}
					customLanguageRenderers={riptideLanguageRenderers}
				/>
			</SentryErrorBoundary>
			{/* Interactive thread card — appears on hover, stays while mouse is over it */}
			{/* Hide hover card when new comment form is open to avoid overlapping dialogs */}
			{activeGutterInfo && activeThread && !pendingCommentAnchor && (
				<div
					className="fixed z-50"
					style={{
						top: Math.max(8, Math.min(activeGutterInfo.rect.top, window.innerHeight - 400)),
						// Position card so its right edge aligns with avatar's right edge (no gap)
						left: Math.max(8, activeGutterInfo.rect.right - 480),
					}}
					onMouseEnter={handleCardMouseEnter}
					onMouseLeave={handleCardMouseLeave}
					// Prevent clicks from propagating and triggering selection changes in the editor
					onMouseDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div className="w-[30rem] max-h-96 overflow-auto shadow-lg bg-popover rounded-md border border-border outline outline-2 outline-accent">
						<WiredCommentThread
							thread={activeThread}
							artifactFilename={viewerProps.fileName}
							onCollapse={() => hideNow()}
							getMarkdownContextForComment={getMarkdownContextForComment}
						/>
					</div>
				</div>
			)}
			{/* Floating new comment form — positioned near the selection */}
			{pendingCommentAnchor && selectionRect && (
				<div
					className="fixed z-50"
					style={
						{
							top: Math.max(8, Math.min(selectionRect.bottom + 8, window.innerHeight - 240)),
							left: Math.max(8, Math.min(selectionRect.left, window.innerWidth - 488)),
							// textarea max-height: viewport - top - 48px bottom padding - ~45px form chrome above textarea
							'--textarea-max-h': `${window.innerHeight - Math.max(8, Math.min(selectionRect.bottom + 8, window.innerHeight - 240)) - 96}px`,
						} as React.CSSProperties
					}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<div className="bg-popover border border-border rounded-md shadow-lg w-[30rem] outline outline-2 outline-accent [&_textarea]:max-h-[var(--textarea-max-h)]">
						<WiredNewCommentForm
							artifactId={artifactId}
							taskId={taskId}
							resourceOwnerUserId={resourceOwnerUserId}
							anchor={pendingCommentAnchor}
							onClose={handleCancelHighlight}
						/>
					</div>
				</div>
			)}
		</div>
	)
}
