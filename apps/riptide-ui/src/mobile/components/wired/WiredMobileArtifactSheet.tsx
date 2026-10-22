import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import {
	buildNavigableBlocks,
	collectAnchorBlocks,
	createWholeBlockAnchor,
	decideDocumentReviewClick,
	MarkdownViewerV2,
	parseAnchorV2,
	RawArtifactView,
	setCommentHighlightProjection,
	setPendingHighlight,
	type AnchorPlacement,
	type AnchorV2,
	type CommentHighlightRange,
	type Editor,
	type NavigableBlock,
	useMarkdownViewerV2Editor,
} from '@humanlayer/ui/artifact-viewer-v2'
import { ArtifactViewer } from '@humanlayer/ui/components/artifact-viewer'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@humanlayer/ui/components/sheet'
import { formatAllThreadsForLlm } from '@humanlayer/ui/lib/comment-utils'
import { isMarkdownFile } from '@humanlayer/ui/lib/file-types'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { Check, Copy, MessageSquare, Send, Undo2 } from 'lucide-react'
import { type FC, type PointerEvent, type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import type { ArtifactCommentsCollection } from '@/collections/electric/artifact-comments'
import { riptideLanguageRenderers } from '@/components/markdown-viewer/language-renderers'
import { useSync, useSyncInternal } from '@/components/providers/SyncProvider'
import { useOrgMembers } from '@/hooks/useOrgMembers'
import { useUserInfo } from '@/hooks/useUserInfo'
import { MobileArtifactSheet, type MobileArtifactSheetProps } from '@/mobile/components/pure/MobileArtifactSheet'
import { MobileCommentComposer } from '@/mobile/components/pure/MobileCommentComposer'
import { MobileCommentThread, type MobileCommentUserInfo } from '@/mobile/components/pure/MobileCommentThread'
import { isThreadUnread, useCommentSeenStore } from '@/mobile/hooks/commentSeenStore'
import { useRiptideApi } from '@/orpc/client'

import { createMobileArtifactCommentV2Actions } from './mobile-artifact-comment-v2-actions'
import {
	projectMobileArtifactCommentV2Threads,
	type MobileArtifactCommentV2Thread as ArtifactCommentThread,
} from './mobile-artifact-comment-v2-threads'

interface MobileArtifactThreadActionsProps {
	thread: ArtifactCommentThread
	canSend: boolean
	onResolve: (commentId: string) => void
	onUnresolve: (commentId: string) => void
	onCopy: (thread: ArtifactCommentThread) => void
	onSend: (thread: ArtifactCommentThread) => void
}

/** Subtle labeled thread action: icon + text on a faint accent wash, no border.
 * `min-h-8!` overrides the sheet's blanket 44px button rule so the visible pill
 * stays compact; the invisible after: overlay keeps the real tap target 44px. */
const threadActionButtonClass =
	'relative flex min-h-8! shrink-0 items-center gap-1.5 bg-accent/10 px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground active:bg-accent/20 after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]'

const MobileArtifactThreadActions: FC<MobileArtifactThreadActionsProps> = ({
	thread,
	canSend,
	onResolve,
	onUnresolve,
	onCopy,
	onSend,
}) => (
	<>
		<button
			type="button"
			className={threadActionButtonClass}
			onClick={() => (thread.root.is_resolved ? onUnresolve(thread.root.id) : onResolve(thread.root.id))}
		>
			{thread.root.is_resolved ? <Undo2 className="size-3.5" /> : <Check className="size-3.5" />}
			{thread.root.is_resolved ? 'Unresolve' : 'Resolve'}
		</button>
		<button type="button" className={threadActionButtonClass} onClick={() => onCopy(thread)}>
			<Copy className="size-3.5" />
			Copy
		</button>
		{canSend && (
			<button type="button" className={threadActionButtonClass} onClick={() => onSend(thread)}>
				<Send className="size-3.5" />
				Send to agent
			</button>
		)}
	</>
)

interface MobileArtifactCommentDocumentLayerProps {
	editor: Editor | null
	blocks: NavigableBlock[]
	highlights: CommentHighlightRange[]
	commentingEnabled: boolean
	onActivate: (rootCommentId: string) => void
	onCompose: (anchor: AnchorV2, range: { from: number; to: number }) => void
	children: ReactNode
}

export const MobileArtifactCommentDocumentLayer: FC<MobileArtifactCommentDocumentLayerProps> = ({
	editor,
	blocks,
	highlights,
	commentingEnabled,
	onActivate,
	onCompose,
	children,
}) => {
	const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
		if (!editor) return
		if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
		if (window.getSelection()?.isCollapsed === false) return
		const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY })
		if (!coords) return
		const decision = decideDocumentReviewClick(coords.pos, blocks, highlights)
		if (decision.kind === 'activate') {
			onActivate(decision.rootCommentId)
			return
		}
		if (decision.kind !== 'target-block' || !commentingEnabled) return

		const anchorBlocks = collectAnchorBlocks(editor.state.doc)
		const blockIndex = anchorBlocks.findIndex((block) => block.pos === decision.block.pos)
		if (blockIndex < 0) return
		const block = anchorBlocks[blockIndex]
		if (block === undefined) return
		onCompose(createWholeBlockAnchor(anchorBlocks, blockIndex), { from: block.pos, to: block.end })
	}

	return <div onPointerUp={handlePointerUp}>{children}</div>
}

interface MobileArtifactCommentThreadItemProps {
	thread: ArtifactCommentThread
	showAnchorContext?: boolean
	showResolvedBadge?: boolean
	isUnread: boolean
	actions: ReactNode
	onJumpToBlock?: () => void
	onReply: (parentCommentId: string, contentText: string) => void
	onDelete: (commentId: string) => void
	onEdit: (commentId: string, contentText: string) => void
	currentUserId: string
	userLookup: Map<string, MobileCommentUserInfo>
}

const MobileArtifactCommentThreadItem: FC<MobileArtifactCommentThreadItemProps> = ({
	thread,
	showAnchorContext = false,
	showResolvedBadge = true,
	isUnread,
	actions,
	onJumpToBlock,
	onReply,
	onDelete,
	onEdit,
	currentUserId,
	userLookup,
}) => (
	<MobileCommentThread
		rootComment={thread.root}
		replies={thread.replies}
		showAnchorContext={showAnchorContext}
		onJumpToBlock={thread.placement.status === 'resolved' ? onJumpToBlock : undefined}
		anchorText={thread.anchorText}
		anchorStatus={thread.placement.status}
		showResolvedBadge={showResolvedBadge}
		isUnread={isUnread}
		actions={actions}
		onReply={onReply}
		onDelete={onDelete}
		onEdit={onEdit}
		currentUserId={currentUserId}
		userLookup={userLookup}
	/>
)

function useWiredMobileArtifactSheetProps(props: MobileArtifactSheetProps) {
	// onSendToSession is only wired by the session page — the task page has no
	// session to send to, so the drawer's Send action is hidden there.
	const { selectedArtifactId, artifacts, onArtifactClose, onOpenChange, onSendToSession } = props
	const { client } = useRiptideApi()
	const { artifactCommentsCollection, artifactsMetadataCollection } = useSync()
	const { confirmTx } = useSyncInternal()
	const { dbOrganizationId, userId } = useUserInfo()
	const { membersMap } = useOrgMembers()
	const lastSeenByThread = useCommentSeenStore((s) => s.lastSeenByThread)
	// Root ids of the focused thread(s) in thread mode — assigned during render
	// and consumed by the mark-seen handlers, so threads are marked seen when
	// the user LEAVES them, not on open (keeping unread markers visible while
	// reading).
	const visibleThreadIdsRef = useRef<string[]>([])
	// In list mode a thread only counts as seen once it has actually been
	// scrolled into view — accumulated by an IntersectionObserver over the list
	// rows, so closing a long list doesn't clear markers on threads the user
	// never reached.
	const viewedListThreadIdsRef = useRef<Set<string>>(new Set())
	const listObserverRef = useRef<IntersectionObserver | null>(null)
	const pendingJumpRootIdRef = useRef<string | null>(null)
	// Callback ref for list rows (no useEffect): observes each row and records
	// it as viewed once a meaningful part of it is on screen — half the row, or
	// a 160px slice for rows taller than half the viewport.
	const observeListRow = useCallback((el: HTMLDivElement | null) => {
		if (!el) return
		if (!listObserverRef.current) {
			listObserverRef.current = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (!entry.isIntersecting) continue
						if (entry.intersectionRatio < 0.5 && entry.intersectionRect.height < 160) continue
						const threadId = (entry.target as HTMLElement).dataset.threadId
						if (threadId) viewedListThreadIdsRef.current.add(threadId)
						listObserverRef.current?.unobserve(entry.target)
					}
				},
				{ threshold: [0.1, 0.25, 0.5] },
			)
		}
		listObserverRef.current.observe(el)
	}, [])
	const markVisibleThreadsSeen = useCallback(() => {
		useCommentSeenStore
			.getState()
			.markThreadsSeen([...visibleThreadIdsRef.current, ...viewedListThreadIdsRef.current])
		// The list session is over — reset the viewed bookkeeping and release
		// the observer (it holds strong refs to the unmounting rows).
		viewedListThreadIdsRef.current = new Set()
		listObserverRef.current?.disconnect()
		listObserverRef.current = null
	}, [])
	const [pendingCommentAnchor, setPendingCommentAnchor] = useState<AnchorV2 | null>(null)
	const [composeDraft, setComposeDraft] = useState('')
	const [activeCommentIds, setActiveCommentIds] = useState<string[]>([])
	// List mode: the full comment list for the artifact (resolved + general/unanchored
	// threads that the tap-a-block gutter markers never surface).
	const [isCommentListOpen, setIsCommentListOpen] = useState(false)

	const selectedArtifact = selectedArtifactId
		? artifacts.find((artifact) => artifact.artifactId === selectedArtifactId)
		: null
	const viewMode = props.viewMode
	const markdownFile = isMarkdownFile(selectedArtifact?.filename ?? '')
	const editor = useMarkdownViewerV2Editor({
		content: props.selectedArtifactContent ?? '',
		customLanguageRenderers: riptideLanguageRenderers,
	})

	const artifactMetadataQuery = useLiveQuery(
		(q) =>
			selectedArtifactId
				? q
						.from({ artifacts: artifactsMetadataCollection })
						.where(({ artifacts: artifact }) => eq(artifact.id, selectedArtifactId))
				: undefined,
		[artifactsMetadataCollection, selectedArtifactId],
	)
	const artifactMetadata = artifactMetadataQuery.data?.[0]

	const commentsQuery = useLiveQuery(
		(q) =>
			selectedArtifactId
				? q
						.from({ comments: artifactCommentsCollection })
						.where(({ comments }) => eq(comments.artifact_id, selectedArtifactId))
				: undefined,
		[artifactCommentsCollection, selectedArtifactId],
	)
	const comments = (commentsQuery.data ?? []) as ArtifactComment[]

	const commentActions = useMemo(
		() =>
			createMobileArtifactCommentV2Actions(
				artifactCommentsCollection as ArtifactCommentsCollection,
				{ comments: client.comments },
				confirmTx.artifactComments,
			),
		[artifactCommentsCollection, client.comments, confirmTx.artifactComments],
	)

	const userLookup = useMemo(() => {
		const map = new Map<string, { displayName?: string; avatarUrl?: string }>()
		for (const [id, member] of membersMap) {
			map.set(id, {
				displayName: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.email,
				avatarUrl: member.profilePictureUrl,
			})
		}
		return map
	}, [membersMap])

	const currentUserDisplayName = userId ? userLookup.get(userId)?.displayName : undefined
	const isCommentingEnabled =
		!!selectedArtifactId &&
		!!artifactMetadata?.task_id &&
		!!artifactMetadata.resource_owner_user_id &&
		!!dbOrganizationId &&
		!!userId

	const blocks = useMemo(() => (editor ? buildNavigableBlocks(editor.state.doc, []) : []), [editor])
	const mobileProjection = useMemo(
		() =>
			editor
				? projectMobileArtifactCommentV2Threads(comments, editor.state.doc, userLookup)
				: emptyMobileProjection(),
		[comments, editor, userLookup],
	)
	const projection = mobileProjection.projection
	const rootThreads = mobileProjection.threads

	// The thread(s) behind a tapped gutter marker.
	const activeThreads = useMemo(() => {
		if (activeCommentIds.length === 0) return []
		const activeIdSet = new Set(activeCommentIds)
		return rootThreads.filter((thread) => activeIdSet.has(thread.root.id))
	}, [activeCommentIds, rootThreads])

	// List mode groups: unresolved first, resolved collapsed to the bottom.
	const unresolvedThreads = useMemo(() => rootThreads.filter((thread) => !thread.root.is_resolved), [rootThreads])
	const resolvedThreads = useMemo(() => rootThreads.filter((thread) => thread.root.is_resolved), [rootThreads])
	const commentCount = rootThreads.length

	// Threads with agent/teammate activity the user hasn't viewed yet — drives
	// the unread markers on the comments button and the list rows.
	const unreadRootIds = useMemo(() => {
		const ids = new Set<string>()
		for (const thread of rootThreads) {
			if (isThreadUnread(lastSeenByThread, userId, thread.root, thread.replies)) ids.add(thread.root.id)
		}
		return ids
	}, [rootThreads, lastSeenByThread, userId])

	const handleCompose = useCallback(
		(anchor: AnchorV2, range: { from: number; to: number }) => {
			if (!editor) return
			markVisibleThreadsSeen()
			setActiveCommentIds([])
			setIsCommentListOpen(false)
			setPendingCommentAnchor(anchor)
			setPendingHighlight(editor.view, range)
		},
		[editor, markVisibleThreadsSeen],
	)

	const handleCommentClick = useCallback(
		(rootCommentId: string) => {
			markVisibleThreadsSeen()
			setPendingCommentAnchor(null)
			setIsCommentListOpen(false)
			if (editor) setPendingHighlight(editor.view, null)
			setActiveCommentIds([rootCommentId])
		},
		[editor, markVisibleThreadsSeen],
	)

	const handleOpenCommentList = useCallback(() => {
		markVisibleThreadsSeen()
		setPendingCommentAnchor(null)
		setActiveCommentIds([])
		if (editor) setPendingHighlight(editor.view, null)
		setIsCommentListOpen(true)
	}, [editor, markVisibleThreadsSeen])

	const handleCancelComment = useCallback(() => {
		markVisibleThreadsSeen()
		setPendingCommentAnchor(null)
		setComposeDraft('')
		setActiveCommentIds([])
		setIsCommentListOpen(false)
		if (editor) setPendingHighlight(editor.view, null)
	}, [editor, markVisibleThreadsSeen])

	const handleJumpToBlock = useCallback(
		(thread: ArtifactCommentThread) => {
			if (!editor || thread.placement.status !== 'resolved') {
				toast.error("Couldn't find that section — the document may have changed")
				return
			}
			handleCancelComment()
			if (viewMode !== 'rendered') {
				pendingJumpRootIdRef.current = thread.root.id
				props.onViewModeChange('rendered')
				return
			}
			scrollToPlacement(editor, thread.placement)
		},
		[editor, handleCancelComment, props, viewMode],
	)

	const bindRenderedDocument = useCallback(
		(node: HTMLDivElement | null) => {
			if (!node || !editor) return
			const pendingRootId = pendingJumpRootIdRef.current
			if (!pendingRootId) return
			const thread = rootThreads.find((candidate) => candidate.root.id === pendingRootId)
			pendingJumpRootIdRef.current = null
			if (thread?.placement.status === 'resolved') {
				const placement = thread.placement
				queueMicrotask(() => scrollToPlacement(editor, placement))
			}
		},
		[editor, rootThreads],
	)

	const handleSheetOpenChange = useCallback(
		(open: boolean) => {
			if (!open) handleCancelComment()
			onOpenChange(open)
		},
		[handleCancelComment, onOpenChange],
	)

	const handleArtifactClose = useCallback(() => {
		handleCancelComment()
		onArtifactClose()
	}, [handleCancelComment, onArtifactClose])

	const handleCreateComment = useCallback(
		(contentText: string, anchor: AnchorV2) => {
			if (
				!selectedArtifactId ||
				!artifactMetadata?.task_id ||
				!artifactMetadata.resource_owner_user_id ||
				!dbOrganizationId ||
				!userId
			) {
				toast.error('Comment sync still loading')
				return
			}

			const commentId = uuidv7()
			void commentActions.createRoot({
				id: commentId,
				organizationId: dbOrganizationId,
				resourceOwnerUserId: artifactMetadata.resource_owner_user_id,
				taskId: artifactMetadata.task_id,
				createdByUserId: userId,
				artifactId: selectedArtifactId,
				contentText,
				anchorJson: anchor,
			})
			// Flip the drawer from compose to the new thread (instead of closing)
			// so reply / resolve / send-to-agent are immediately available.
			setPendingCommentAnchor(null)
			setComposeDraft('')
			if (editor) setPendingHighlight(editor.view, null)
			setActiveCommentIds([commentId])
		},
		[artifactMetadata, commentActions, dbOrganizationId, editor, selectedArtifactId, userId],
	)

	const handleReplyComment = useCallback(
		(replyToCommentId: string, contentText: string) => {
			if (
				!selectedArtifactId ||
				!artifactMetadata?.task_id ||
				!artifactMetadata.resource_owner_user_id ||
				!dbOrganizationId ||
				!userId
			) {
				toast.error('Comment sync still loading')
				return
			}

			void commentActions.createReply({
				id: uuidv7(),
				organizationId: dbOrganizationId,
				resourceOwnerUserId: artifactMetadata.resource_owner_user_id,
				taskId: artifactMetadata.task_id,
				createdByUserId: userId,
				artifactId: selectedArtifactId,
				contentText,
				rootCommentId: replyToCommentId,
			})
		},
		[artifactMetadata, commentActions, dbOrganizationId, selectedArtifactId, userId],
	)

	const handleDeleteComment = useCallback(
		(commentId: string) => {
			const root = rootThreads.find((thread) => thread.root.id === commentId)
			void commentActions.deleteComment({
				commentId,
				memberIds: root ? [root.root.id, ...root.replies.map((reply) => reply.id)] : undefined,
			})
			// Deleting a root removes the whole thread from view. If that was the
			// last thread the focused sheet was showing, close it rather than
			// leave an empty drawer. (List mode keeps its other threads.)
			if (
				activeCommentIds.length > 0 &&
				activeThreads.some((thread) => thread.root.id === commentId) &&
				activeThreads.every((thread) => thread.root.id === commentId)
			) {
				handleCancelComment()
			}
		},
		[commentActions, activeCommentIds, activeThreads, handleCancelComment, rootThreads],
	)

	const handleEditComment = useCallback(
		(commentId: string, contentText: string) => {
			void commentActions.editComment({ commentId, contentText })
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

	// Which mode the bottom sheet is in (mutually exclusive; the handlers above
	// clear the other two whenever one opens). Thread mode keys off the id list
	// (not the resolved threads) so the drawer stays open while a just-created
	// comment's optimistic insert propagates through the live query.
	let sheetMode: 'compose' | 'thread' | 'list' | null = null
	if (pendingCommentAnchor) sheetMode = 'compose'
	else if (activeCommentIds.length > 0) sheetMode = 'thread'
	else if (isCommentListOpen) sheetMode = 'list'

	let sheetDescription = 'Comment thread for the highlighted section'
	if (sheetMode === 'compose') sheetDescription = 'Add a comment on the highlighted section'
	else if (sheetMode === 'list') {
		sheetDescription = `${unresolvedThreads.length} open and ${resolvedThreads.length} resolved comment threads`
	}

	// Focused thread(s) are fully on screen in thread mode, so they count as
	// seen when the user leaves. List-mode threads are tracked individually by
	// the IntersectionObserver above instead.
	visibleThreadIdsRef.current = sheetMode === 'thread' ? activeThreads.map((thread) => thread.root.id) : []

	const formatThreads = (threads: ArtifactCommentThread[]) =>
		formatAllThreadsForLlm({
			artifactFilename: selectedArtifact?.filename,
			userLookup,
			threads: threads.map(({ root, replies }) => {
				const anchor = parseAnchorV2(root.anchor_json)
				return {
					markdownContext: anchor
						? {
								previousMarkdown: anchor.start.previousBlockText,
								currentMarkdown: anchor.selectedText,
								nextMarkdown: anchor.end.nextBlockText,
							}
						: null,
					rootComment: {
						id: root.id,
						contentText: root.content_text,
						isResolved: root.is_resolved,
						createdByUserId: root.created_by_user_id,
					},
					replies: replies.map((reply) => ({
						id: reply.id,
						contentText: reply.content_text,
						isResolved: reply.is_resolved,
						createdByUserId: reply.created_by_user_id,
					})),
				}
			}),
		})

	const handleThreadCopy = (thread: ArtifactCommentThread) => {
		navigator.clipboard.writeText(formatThreads([thread])).then(
			() => toast.success('Comments copied', { duration: 2000 }),
			() => toast.error('Copy failed'),
		)
	}

	// Send one thread straight to the session. From a focused thread the send
	// completes the loop — the drawer closes and the artifact stays open so the
	// comment-driven cycle (comment → send → keep reading) continues in place.
	// From the all-comments list the drawer stays open so the user can keep
	// working through the remaining threads. The send path applies the composer's
	// permission/status guards and reports how it dispatched — a blocked send
	// (already toasted by the hook) leaves the drawer untouched.
	const handleThreadSend = (thread: ArtifactCommentThread) => {
		if (!onSendToSession) return
		const result = onSendToSession(formatThreads([thread]))
		if (!result) return
		toast.success(result === 'queued' ? 'Queued for agent' : 'Sent to agent', { duration: 3000 })
		if (sheetMode === 'thread') handleCancelComment()
	}

	// Header count reflects only OPEN threads; the button stays visible while any
	// threads exist (even all-resolved) so the list remains reachable.
	const headerAccessory =
		selectedArtifact && commentCount > 0 ? (
			<button
				type="button"
				onClick={handleOpenCommentList}
				className="flex h-11 shrink-0 items-center gap-1.5 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
				aria-label={
					unreadRootIds.size > 0
						? `View comments (${unresolvedThreads.length} open, ${unreadRootIds.size} with new activity)`
						: `View comments (${unresolvedThreads.length} open)`
				}
			>
				<MessageSquare className="h-4 w-4" />
				{unresolvedThreads.length > 0 && unresolvedThreads.length}
				{unreadRootIds.size > 0 && <span className="size-1.5 bg-[var(--terminal-accent)]" aria-hidden />}
			</button>
		) : undefined

	const syncHighlights = useCallback(
		(node: HTMLSpanElement | null) => {
			if (!node || !editor) return
			setCommentHighlightProjection(editor.view, projection.highlights, activeCommentIds)
		},
		[activeCommentIds, editor, projection.highlights],
	)

	const artifactViewerSlot =
		selectedArtifact && props.selectedArtifactContent !== undefined ? (
			<>
				{markdownFile && viewMode === 'rendered' ? (
					<MobileArtifactCommentDocumentLayer
						editor={editor}
						blocks={blocks}
						highlights={projection.highlights}
						commentingEnabled={isCommentingEnabled}
						onActivate={handleCommentClick}
						onCompose={handleCompose}
					>
						<div ref={bindRenderedDocument} className="min-h-full">
							<span ref={syncHighlights} hidden />
							<MarkdownViewerV2 editor={editor} />
						</div>
					</MobileArtifactCommentDocumentLayer>
				) : markdownFile ? (
					<RawArtifactView content={props.selectedArtifactContent} fileName={selectedArtifact.filename} />
				) : (
					<ArtifactViewer
						content={props.selectedArtifactContent}
						fileName={selectedArtifact.filename}
						noBorder
						hideHeader
						showHotkeyHints={false}
						hideCommentGutter
						tabValue={viewMode}
						onTabValueChange={props.onViewModeChange}
						customLanguageRenderers={riptideLanguageRenderers}
					/>
				)}
				<Sheet open={sheetMode !== null} onOpenChange={(open) => !open && handleCancelComment()}>
					<SheetContent
						side="bottom"
						className="max-h-[75dvh] gap-0 rounded-none p-0 pb-[calc(env(safe-area-inset-bottom)+var(--keyboard-inset,0px))] [&_.rounded-md]:rounded-none [&_.rounded-sm]:rounded-none [&_button]:min-h-11 [&_button]:min-w-11 [&_textarea]:text-base [&>button]:top-0 [&>button]:right-0 [&>button]:flex [&>button]:items-center [&>button]:justify-center"
					>
						<SheetHeader className={sheetMode === 'compose' ? 'px-4 pt-3 pb-1' : 'sr-only'}>
							<SheetTitle
								className={
									sheetMode === 'compose'
										? 'text-center text-xs font-medium tracking-[0.2em] text-muted-foreground'
										: undefined
								}
							>
								{sheetMode === 'compose' ? 'COMMENT ON ARTIFACT' : 'Comments'}
							</SheetTitle>
							<SheetDescription className="sr-only">{sheetDescription}</SheetDescription>
						</SheetHeader>
						<div className={`overflow-y-auto px-4 pb-3 ${sheetMode === 'compose' ? 'pt-1' : 'pt-11'}`}>
							{pendingCommentAnchor && selectedArtifactId && (
								<MobileCommentComposer
									value={composeDraft}
									onChange={setComposeDraft}
									onSubmit={(contentText) => handleCreateComment(contentText, pendingCommentAnchor)}
									placeholder="Add a comment..."
									autoFocus
									authorDisplayName={currentUserDisplayName}
									authorAvatarUrl={userId ? userLookup.get(userId)?.avatarUrl : undefined}
								/>
							)}
							{sheetMode === 'thread' && (
								<div className="space-y-5">
									{activeThreads.map((thread) => (
										<MobileArtifactCommentThreadItem
											key={thread.root.id}
											thread={thread}
											isUnread={unreadRootIds.has(thread.root.id)}
											actions={
												<MobileArtifactThreadActions
													thread={thread}
													canSend={!!onSendToSession}
													onResolve={handleResolveComment}
													onUnresolve={handleUnresolveComment}
													onCopy={handleThreadCopy}
													onSend={handleThreadSend}
												/>
											}
											onReply={handleReplyComment}
											onDelete={handleDeleteComment}
											onEdit={handleEditComment}
											currentUserId={userId ?? ''}
											userLookup={userLookup}
										/>
									))}
								</div>
							)}
							{sheetMode === 'list' && (
								/* List rows get the kanban-card treatment (subtle bg, square
								   corners) so adjacent threads read as separate items. */
								<div className="space-y-3">
									{unresolvedThreads.map((thread) => (
										<div
											key={thread.root.id}
											ref={observeListRow}
											data-thread-id={thread.root.id}
											className="bg-accent/5 p-3"
										>
											<MobileArtifactCommentThreadItem
												thread={thread}
												showAnchorContext
												onJumpToBlock={() => handleJumpToBlock(thread)}
												isUnread={unreadRootIds.has(thread.root.id)}
												actions={
													<MobileArtifactThreadActions
														thread={thread}
														canSend={!!onSendToSession}
														onResolve={handleResolveComment}
														onUnresolve={handleUnresolveComment}
														onCopy={handleThreadCopy}
														onSend={handleThreadSend}
													/>
												}
												onReply={handleReplyComment}
												onDelete={handleDeleteComment}
												onEdit={handleEditComment}
												currentUserId={userId ?? ''}
												userLookup={userLookup}
											/>
										</div>
									))}
									{resolvedThreads.length > 0 && (
										<>
											{/* Section divider for the resolved group — the rows below
													    drop their per-thread badge in favor of this header.
													    scale-x keeps the 1px rule ~20% wider than the label
													    without fighting shrink-to-fit percentage sizing. */}
											<div className="flex justify-center pt-1">
												<span className="inline-flex flex-col items-center gap-1 text-xs text-[var(--terminal-success)]">
													Resolved
													<span
														className="h-px w-full scale-x-[1.2] bg-[var(--terminal-success)]"
														aria-hidden
													/>
												</span>
											</div>
											{resolvedThreads.map((thread) => (
												<div
													key={thread.root.id}
													ref={observeListRow}
													data-thread-id={thread.root.id}
													className="bg-accent/5 p-3"
												>
													<MobileArtifactCommentThreadItem
														thread={thread}
														showAnchorContext
														onJumpToBlock={() => handleJumpToBlock(thread)}
														showResolvedBadge={false}
														isUnread={unreadRootIds.has(thread.root.id)}
														actions={
															<MobileArtifactThreadActions
																thread={thread}
																canSend={!!onSendToSession}
																onResolve={handleResolveComment}
																onUnresolve={handleUnresolveComment}
																onCopy={handleThreadCopy}
																onSend={handleThreadSend}
															/>
														}
														onReply={handleReplyComment}
														onDelete={handleDeleteComment}
														onEdit={handleEditComment}
														currentUserId={userId ?? ''}
														userLookup={userLookup}
													/>
												</div>
											))}
										</>
									)}
									{commentCount === 0 && (
										<p className="py-6 text-center text-sm text-muted-foreground">
											No comments yet
										</p>
									)}
								</div>
							)}
						</div>
					</SheetContent>
				</Sheet>
			</>
		) : undefined

	return {
		onOpenChange: handleSheetOpenChange,
		onArtifactClose: handleArtifactClose,
		headerAccessory,
		artifactViewerSlot,
	}
}

export function WiredMobileArtifactSheet(props: MobileArtifactSheetProps) {
	return (
		<WiredMobileArtifactSheetComposition
			key={`${props.selectedArtifactId ?? 'list'}:${props.selectedArtifactContent ?? ''}`}
			{...props}
		/>
	)
}

function WiredMobileArtifactSheetComposition(props: MobileArtifactSheetProps) {
	const wiredProps = useWiredMobileArtifactSheetProps(props)
	return <MobileArtifactSheet {...props} {...wiredProps} />
}

function emptyMobileProjection(): ReturnType<typeof projectMobileArtifactCommentV2Threads> {
	return {
		projection: { threads: [], resolvedThreads: [], highlights: [], rootIds: new Set() },
		threads: [],
	}
}

function scrollToPlacement(editor: Editor, placement: Extract<AnchorPlacement, { status: 'resolved' }>): void {
	const node = editor.view.nodeDOM(placement.from)
	const directElement = node instanceof HTMLElement ? node : null
	const domAtPos = directElement ? null : editor.view.domAtPos(placement.from).node
	const target =
		directElement ??
		(domAtPos instanceof HTMLElement ? domAtPos : domAtPos instanceof Node ? domAtPos.parentElement : null)
	target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
