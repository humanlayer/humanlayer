import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	ArtifactCommentPanel,
	type ArtifactCommentPanelHandle,
	NEW_COMMENT_KEY,
	useCommentThreads,
} from '@humanlayer/ui/components/artifact-comment-panel'
import { ArtifactViewer, type ArtifactViewerProps } from '@humanlayer/ui/components/artifact-viewer'
import { CommentThread } from '@humanlayer/ui/components/comment-thread'
import { CommentsBulkActionsDropdown } from '@humanlayer/ui/components/comments-bulk-actions-dropdown'
import { NewCommentForm } from '@humanlayer/ui/components/new-comment-form'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@humanlayer/ui/components/resizable'
import { useMountEffect } from '@humanlayer/ui/hooks/use-mount-effect'
import { partitionCommentRowsByRootFormat } from '@humanlayer/ui/lib/artifact-comment-format'
import { getCommentColorForUser } from '@humanlayer/ui/lib/comment-utils'
import { isMarkdownFile } from '@humanlayer/ui/lib/file-types'
import type { CommentBlockHoverInfo, CommentClickInfo } from '@humanlayer/ui/markdown-viewer/CommentGutter'
import { setPendingHighlightBlock } from '@humanlayer/ui/markdown-viewer/CommentGutter'
import type { GutterItemInfo } from '@humanlayer/ui/markdown-viewer/CommentGutterOverlay'
import type { CommentData } from '@humanlayer/ui/markdown-viewer/MarkdownViewer'
import { eq, useLiveQuery } from '@tanstack/react-db'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { createCommentActions } from '@/actions/comments'
import { useRiptideApi } from '@/api/client'
import { ArtifactViewerV2 } from '@/components/artifact-viewer-v2/ArtifactViewerV2'
import { useArtifactVersions } from '@/components/artifact-viewer-v2/useArtifactVersions'
import { ArtifactViewerVersionToggle } from '@/components/ArtifactViewerVersionToggle'
import { TaskArtifactViewer } from '@/components/TaskArtifactViewer'
import { useArtifactViewerStore } from '@/hooks/stores/artifactViewerStore'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'
import { useSync, useSyncInternal } from '@/providers/SyncProvider'

const cloudLanguageRenderers = {
	'task-artifact': TaskArtifactViewer,
}

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
	artifactId: string
	taskId: string
	resourceOwnerUserId: string
	displayMode: 'sidebar' | 'fullscreen'
}

/**
 * Narrow default/legacy boundary gate. Markdown artifacts use V2 by default
 * and can opt into V1 for legacy comments. The anonymous shared-artifact route
 * does not pass through this component and is untouched.
 */
export function WiredArtifactViewer(props: WiredArtifactViewerProps) {
	const forceLegacyViewer = useArtifactViewerStore((state) => !!state.forceLegacyViewerByArtifactId[props.artifactId])
	const isMarkdownArtifact = isMarkdownFile(props.fileName ?? '')
	const actionsMenu = (
		<>
			{props.actionsMenu}
			<ArtifactViewerVersionToggle artifactId={props.artifactId} fileName={props.fileName} />
		</>
	)

	if (!forceLegacyViewer && isMarkdownArtifact) {
		return <WiredArtifactViewerV2 {...props} actionsMenu={actionsMenu} />
	}

	return <WiredArtifactViewerV1 {...props} actionsMenu={actionsMenu} />
}

function WiredArtifactViewerV2(props: WiredArtifactViewerProps) {
	const viewMode = props.tabValue ?? props.defaultView ?? 'rendered'
	const versionDiff = useArtifactVersions({
		artifactId: props.artifactId,
		currentContent: props.content,
		enabled: viewMode === 'diff',
	})

	return (
		<ArtifactViewerV2
			artifactId={props.artifactId}
			taskId={props.taskId}
			resourceOwnerUserId={props.resourceOwnerUserId}
			content={props.content}
			fileName={props.fileName ?? 'artifact.md'}
			viewMode={viewMode}
			onViewModeChange={props.onTabValueChange ?? (() => {})}
			externalEditorRef={props.editorRef}
			searchQuery={props.searchQuery}
			searchCurrentMatch={props.searchCurrentMatch}
			searchEnabled={props.searchEnabled}
			onSearchToggleRequest={props.onSearchToggleRequest}
			hideHeader={props.hideHeader}
			actionsMenu={props.actionsMenu}
			versionDiff={versionDiff}
		>
			{props.children}
		</ArtifactViewerV2>
	)
}

function WiredArtifactViewerV1({
	artifactId,
	taskId,
	resourceOwnerUserId,
	displayMode,
	editorRef: externalEditorRef,
	...viewerProps
}: WiredArtifactViewerProps) {
	const { client } = useRiptideApi()
	const { artifactCommentsCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	// User lookup for comment components (id → display identity), built once in the hook.
	const { identityMap: userLookup } = useOrgMembers()

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
	// partition. V2-anchored roots (and their replies) must never render as
	// Cloud V1 general comments or enter V1 counts/threads.
	const allComments = useMemo(() => partitionCommentRowsByRootFormat(rawComments).legacy, [rawComments])

	// Instantiate comment actions
	const commentActions = useMemo(
		() =>
			createCommentActions(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				artifactCommentsCollection as any,
				{ comments: client.comments },
				confirmTx.artifactComments,
			),
		[artifactCommentsCollection, client, confirmTx.artifactComments],
	)

	// Compute unresolved threads for bulk actions dropdown
	const unresolvedThreads = useMemo(() => {
		const activeComments = allComments.filter((c) => !c.is_deleted && !c.is_resolved)
		const rootComments = activeComments.filter((c) => !c.reply_to_comment_id)
		return rootComments.map((root) => {
			const replies = allComments.filter((c) => !c.is_deleted && c.reply_to_comment_id === root.id)
			return {
				markdownContext:
					root.commented_upon_block_text || root.previous_block_text || root.next_block_text
						? {
								previousMarkdown: root.previous_block_text,
								currentMarkdown: root.commented_upon_block_text,
								nextMarkdown: root.next_block_text,
							}
						: null,
				rootComment: {
					id: root.id,
					contentText: root.content_text,
					isResolved: root.is_resolved,
					createdByUserId: root.created_by_user_id,
				},
				replies: replies.map((r) => ({
					id: r.id,
					contentText: r.content_text,
					isResolved: r.is_resolved,
					createdByUserId: r.created_by_user_id,
				})),
			}
		})
	}, [allComments])

	const handleResolveAllComments = useCallback(() => {
		commentActions.resolveAllComments({ artifactId })
	}, [commentActions, artifactId])

	const commentsBulkActionsMenu = (
		<CommentsBulkActionsDropdown
			artifactFilename={viewerProps.fileName ?? undefined}
			threads={unresolvedThreads}
			userLookup={userLookup}
			onResolveAll={handleResolveAllComments}
		/>
	)
	const actionsMenu = (
		<>
			{commentsBulkActionsMenu}
			{viewerProps.actionsMenu}
		</>
	)

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

	// Gutter interaction state (hover-only, no click popover)
	const [activeGutterInfo, setActiveGutterInfo] = useState<GutterItemInfo | null>(null)
	const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Comment panel ref for fullscreen mode
	const commentPanelRef = useRef<ArtifactCommentPanelHandle | null>(null)
	// Artifact viewer container ref for computing relative positions
	const artifactContainerRef = useRef<HTMLDivElement>(null)
	// Comment panel container ref for scroll sync
	const commentPanelContainerRef = useRef<HTMLDivElement>(null)
	// Editor ref for computing line positions (typed as any since @tiptap/react is in packages/ui)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const internalEditorRef = useRef<any>(null)
	// Use external editorRef when provided so callers (e.g., search) can read the editor.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const editorRef = (externalEditorRef as React.MutableRefObject<any> | undefined) ?? internalEditorRef
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

			// Collect all textblocks with their context
			const blocks: { pos: number; text: string; idx: number }[] = []
			let blockIdx = 0
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			doc.descendants((node: any, pos: number) => {
				if (!node.isTextblock) return
				blockIdx++
				blocks.push({ pos: pos + 1, text: node.textContent, idx: blockIdx })
			})

			for (const comment of allComments) {
				if (comment.is_deleted || !comment.commented_upon_block_text) continue

				// Context-based matching: find block by textContent + prev/next
				let bestBlockIdx = -1
				let bestScore = 0

				for (let i = 0; i < blocks.length; i++) {
					const block = blocks[i]
					if (!block || block.text !== comment.commented_upon_block_text) continue

					let score = 1
					const prevText = i > 0 ? (blocks[i - 1]?.text ?? null) : null
					if (comment.previous_block_text === prevText) score += 2
					else if (comment.previous_block_text === null && prevText === null) score += 2

					const nextText = i < blocks.length - 1 ? (blocks[i + 1]?.text ?? null) : null
					if (comment.next_block_text === nextText) score += 2
					else if (comment.next_block_text === null && nextText === null) score += 2

					if (score > bestScore) {
						bestScore = score
						bestBlockIdx = i
					}
				}

				if (bestBlockIdx === -1) continue

				const best = blocks[bestBlockIdx]
				if (!best) continue
				const effectiveLineNumber = best.idx

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
	}, [allComments, displayMode])

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
		[],
	)

	const handleCreateComment = useCallback(
		(
			contentText: string,
			contentJson?: string,
			anchor?: {
				commentedUponBlockText: string
				previousBlockText: string | null
				nextBlockText: string | null
			},
		) => {
			if (!dbOrganizationId || !userId) {
				return
			}
			commentActions.createComment({
				id: uuidv7(),
				organizationId: dbOrganizationId,
				resourceOwnerUserId,
				taskId,
				createdByUserId: userId,
				artifactId,
				contentText,
				contentJson: contentJson ?? undefined,
				commentedUponBlockText: anchor?.commentedUponBlockText,
				previousBlockText: anchor?.previousBlockText,
				nextBlockText: anchor?.nextBlockText,
			})
			toast.success('Comment added', { duration: 3000, closeButton: true })
			setPendingCommentAnchor(null)
			setSelectionRect(null)
			if (editorRef.current?.view) {
				setPendingHighlightBlock(editorRef.current.view, null)
			}
		},
		[commentActions, dbOrganizationId, userId, resourceOwnerUserId, taskId, artifactId],
	)

	const handleReplyComment = useCallback(
		(replyToCommentId: string, contentText: string, contentJson?: string) => {
			if (!dbOrganizationId || !userId) return
			commentActions.createComment({
				id: uuidv7(),
				organizationId: dbOrganizationId,
				resourceOwnerUserId,
				taskId,
				createdByUserId: userId,
				artifactId,
				contentText,
				contentJson: contentJson ?? undefined,
				replyToCommentId,
			})
		},
		[commentActions, dbOrganizationId, userId, resourceOwnerUserId, taskId, artifactId],
	)

	const handleDeleteComment = useCallback(
		(commentId: string) => {
			void commentActions.deleteComment({ commentId })
		},
		[commentActions],
	)

	const handleEditComment = useCallback(
		(commentId: string, contentText: string, contentJson: string) => {
			commentActions.editComment({ commentId, contentText, contentJson })
		},
		[commentActions],
	)

	const handleResolveComment = useCallback(
		(commentId: string) => {
			commentActions.resolveComment({ commentId, isResolved: true })
		},
		[commentActions],
	)

	const handleUnresolveComment = useCallback(
		(commentId: string) => {
			commentActions.resolveComment({ commentId, isResolved: false })
		},
		[commentActions],
	)

	// Hover handler for gutter items
	const handleGutterItemHover = useCallback((info: GutterItemInfo | null) => {
		if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
		if (info) {
			hoverTimeoutRef.current = setTimeout(() => setActiveGutterInfo(info), 200)
		} else {
			// Longer delay on leave to bridge the gap between avatar and card
			hoverTimeoutRef.current = setTimeout(() => setActiveGutterInfo(null), 400)
		}
	}, [])

	const handleCardMouseEnter = useCallback(() => {
		if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
	}, [])

	const handleCardMouseLeave = useCallback(() => {
		if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
		hoverTimeoutRef.current = setTimeout(() => setActiveGutterInfo(null), 400)
	}, [])

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
				if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
				// Non-fullscreen: show hover card (same as gutter hover)
				if (info) {
					// Convert CommentBlockHoverInfo to GutterItemInfo-like shape
					const gutterInfo: GutterItemInfo = {
						lineNumber: 0, // Not used for hover card positioning
						comments: info.comments,
						rect: info.rect,
					}
					hoverTimeoutRef.current = setTimeout(() => setActiveGutterInfo(gutterInfo), 200)
				} else {
					hoverTimeoutRef.current = setTimeout(() => setActiveGutterInfo(null), 400)
				}
			}
		},
		[displayMode],
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const markdownManager = (editor as any).markdown as { serialize: (json: any) => string } | undefined
			if (!markdownManager) return null

			const comment = allComments.find((c) => c.id === commentId)
			if (!comment?.commented_upon_block_text) return null

			const doc = editor.state.doc
			const blocks: { text: string; json: Record<string, unknown> }[] = []
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			doc.descendants((node: any) => {
				if (!node.isTextblock) return
				blocks.push({ text: node.textContent, json: node.toJSON() as Record<string, unknown> })
			})

			let bestIdx = -1
			let bestScore = 0
			for (let i = 0; i < blocks.length; i++) {
				const block = blocks[i]
				if (!block || block.text !== comment.commented_upon_block_text) continue
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
				const block = blocks[idx]
				if (!block) return null
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

	// Scroll sync handler for fullscreen mode
	const handleArtifactScroll = useCallback(() => {
		if (!artifactContainerRef.current || !commentPanelContainerRef.current) return
		commentPanelContainerRef.current.scrollTop = artifactContainerRef.current.scrollTop
	}, [])

	const [commentPanelHeight, setCommentPanelHeight] = useState(0)

	useMountEffect(() => {
		const el = commentPanelContainerRef.current
		if (!el) return
		const ro = new ResizeObserver(([entry]) => {
			if (!entry) return
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
		const root = rootComments[0]
		if (!root) return null
		const replies = allComments.filter((c) => !c.is_deleted && c.reply_to_comment_id === root.id)
		return { root, replies }
	}, [activeGutterInfo, allComments])

	const focusCommentThread = useCallback(
		(commentIds: string[], fallbackLineNumber?: number) => {
			if (displayMode !== 'fullscreen') return
			setActiveGutterInfo(null)

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
		[displayMode],
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
				if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
				setPendingCommentAnchor(null)
				setSelectionRect(null)
				if (editorRef.current?.view) {
					setPendingHighlightBlock(editorRef.current.view, null)
				}
				setActiveGutterInfo({
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
		[displayMode, editorRef, focusCommentThread],
	)

	const handleArtifactChromeClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
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
			<ResizablePanelGroup orientation="horizontal" className="flex-1 min-h-0">
				<ResizablePanel id="artifact" defaultSize="65%" minSize="40%">
					<div
						ref={artifactContainerRef}
						className="h-full overflow-auto"
						onClick={handleArtifactChromeClick}
						onScroll={handleArtifactScroll}
					>
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
							actionsMenu={actionsMenu}
							customLanguageRenderers={cloudLanguageRenderers}
							showDownloadButton
						/>
					</div>
				</ResizablePanel>

				<ResizableHandle withHandle />

				<ResizablePanel id="comments" defaultSize="35%" minSize="20%" maxSize="60%">
					<div ref={commentPanelContainerRef} className="h-full border-l border-border overflow-auto p-3">
						<ArtifactCommentPanel
							ref={commentPanelRef}
							comments={allComments}
							linePositions={linePositions}
							computedLineNumbers={computedLineNumbers}
							newCommentY={newCommentY}
							containerHeight={commentPanelHeight}
							highlightedCommentIds={hoveredCommentIds}
						>
							{panelThreads.map(({ thread, isOutdated }) => (
								<CommentThread
									key={thread.root.id}
									rootComment={thread.root}
									replies={thread.replies}
									onReply={handleReplyComment}
									onDelete={handleDeleteComment}
									onEdit={handleEditComment}
									onResolve={thread.root.is_resolved ? undefined : handleResolveComment}
									onUnresolve={thread.root.is_resolved ? handleUnresolveComment : undefined}
									currentUserId={userId ?? ''}
									userLookup={userLookup}
									getMarkdownContextForComment={getMarkdownContextForComment}
									isOutdated={isOutdated}
								/>
							))}
							{pendingCommentAnchor ? (
								<NewCommentForm
									key={NEW_COMMENT_KEY}
									artifactId={artifactId}
									onSubmit={handleCreateComment}
									pendingCommentAnchor={pendingCommentAnchor}
									onCancelHighlight={handleCancelHighlight}
									currentUserDisplayName={userLookup.get(userId ?? '')?.displayName}
								/>
							) : null}
						</ArtifactCommentPanel>
					</div>
				</ResizablePanel>
			</ResizablePanelGroup>
		)
	}

	return (
		<div className="relative overflow-x-hidden">
			<ArtifactViewer
				key={artifactId}
				{...viewerProps}
				comments={commentData}
				onCommentClick={handleCommentClick}
				onBlockClick={handleBlockClick}
				onGutterItemHover={handleGutterItemHover}
				onCommentBlockHover={handleCommentBlockHover}
				editorRef={editorRef}
				actionsMenu={actionsMenu}
				customLanguageRenderers={cloudLanguageRenderers}
				showDownloadButton
			/>
			{/* Interactive thread card — appears on hover, stays while mouse is over it */}
			{activeGutterInfo && activeThread && (
				<div
					className="fixed z-50"
					style={{
						top: activeGutterInfo.rect.top,
						// Position card so its right edge aligns with avatar's right edge (no gap)
						left: Math.max(8, activeGutterInfo.rect.right - 384),
					}}
					onMouseEnter={handleCardMouseEnter}
					onMouseLeave={handleCardMouseLeave}
					// Prevent clicks from propagating and triggering selection changes in the editor
					onMouseDown={(e) => e.stopPropagation()}
					onClick={(e) => e.stopPropagation()}
					onPointerDown={(e) => e.stopPropagation()}
				>
					<div className="w-96 max-h-96 overflow-auto shadow-lg bg-popover rounded-md border border-border outline outline-2 outline-accent">
						<CommentThread
							rootComment={activeThread.root}
							replies={activeThread.replies}
							onReply={(replyToId, text, json) => handleReplyComment(replyToId, text, json)}
							onDelete={handleDeleteComment}
							onEdit={handleEditComment}
							onResolve={activeThread.root.is_resolved ? undefined : handleResolveComment}
							onUnresolve={activeThread.root.is_resolved ? handleUnresolveComment : undefined}
							onCollapse={() => setActiveGutterInfo(null)}
							currentUserId={userId ?? ''}
							userLookup={userLookup}
							getMarkdownContextForComment={getMarkdownContextForComment}
						/>
					</div>
				</div>
			)}
			{/* Floating new comment form — positioned near the selection */}
			{pendingCommentAnchor && selectionRect && (
				<div
					className="fixed z-50"
					style={{
						top: selectionRect.bottom + 8,
						left: Math.max(8, selectionRect.left),
					}}
					onMouseDown={(e) => e.stopPropagation()}
				>
					<div className="bg-popover border border-border rounded-md shadow-lg w-80 outline outline-2 outline-accent">
						<NewCommentForm
							artifactId={artifactId}
							onSubmit={handleCreateComment}
							pendingCommentAnchor={pendingCommentAnchor}
							onCancelHighlight={handleCancelHighlight}
							currentUserDisplayName={userLookup.get(userId ?? '')?.displayName}
						/>
					</div>
				</div>
			)}
		</div>
	)
}
