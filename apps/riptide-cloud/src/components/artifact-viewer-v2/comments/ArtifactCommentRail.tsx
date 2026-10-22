import {
	ArtifactCommentDeleteDialog,
	ArtifactCommentReply,
	ArtifactCommentThread,
	ArtifactReviewRail,
	collectDismissedThreads,
	commentVisibilityEmptyLabel,
	CommentVisibilityToggle,
	mergeDismissingThreads,
	originalAnchorText,
	ReplyComposer,
	revealDeepLinkTarget,
	useCommentVisibilityPreference,
	visibilityRevealing,
	visibleThreads,
	type ArtifactCommentEditInput,
	type CommentKind,
	type DismissingThread,
	type ProjectedCommentThread,
	isArtifactCommentRootActive,
	isThreadResolved,
	useArtifactCommentFocusStore,
} from '@humanlayer/ui/artifact-viewer-v2'
import { type ComponentProps, type ReactNode, type RefObject, useCallback, useRef, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import { ArtifactThreadDelivery } from '../delivery/ArtifactThreadDelivery'
import type { RailDeepLinkReveal } from '../useCommentDeepLink'

/** Coerce the persisted `kind` text column into the typed vocabulary. */
function toCommentKind(kind: string): CommentKind {
	return kind === 'deletion' || kind === 'approval' ? kind : 'comment'
}

export interface ArtifactCommentRailProps {
	children?: ReactNode
	artifactId: string
	fileName: string
	/** Open (unresolved) threads, in document order. */
	threads: ProjectedCommentThread[]
	/** Resolved threads, shown under Resolved and All. */
	resolvedThreads: ProjectedCommentThread[]
	activateThread: (rootId: string, options: { reveal: 'rail' | 'document' }) => void
	hoverThread: (rootId: string | null) => void
	railRef: RefObject<HTMLElement | null>
	/** The root whose reply composer is open (one per rail), or null. */
	replyComposerRootId: string | null
	openReplyComposer: (rootId: string) => void
	closeReplyComposer: () => void
	submitReply: (rootCommentId: string, contentText: string) => Promise<boolean>
	resolveThread: (rootCommentId: string) => void
	reopenThread: (rootCommentId: string) => void
	currentUserDisplayName: string | undefined
	currentUserAvatarUrl: string | undefined
	currentUserId: string | undefined
	editComment: (input: ArtifactCommentEditInput) => unknown
	deleteComment: (input: { commentId: string; memberIds?: string[] }) => unknown
	/**
	 * Route-driven one-shot reveal seam (Phase 4). When set, the rail switches
	 * filters only if the current one hides the target, then scrolls and
	 * briefly emphasizes the root or reply card.
	 */
	deepLinkReveal: RailDeepLinkReveal | null
	/** Reports one applied reveal so a rail remount cannot repeat it. */
	onDeepLinkRevealApplied: () => void
	/** Copy Link composition: URL building and clipboard stay with the caller. */
	copyThreadLink: (rootId: string) => void
}

interface DeleteTarget {
	commentId: string
	memberIds: string[]
	target: 'reply' | 'root'
	replyCount: number
}

interface ArtifactCommentRepliesProps {
	replies: ProjectedCommentThread['replies']
	rootId: string
	currentUserId: string | undefined
	editComment: (input: ArtifactCommentEditInput) => unknown
	activateThread: (rootId: string, options: { reveal: 'document' }) => void
	hoverThread: (rootId: string | null) => void
	onRequestReplyDelete: (commentId: string, returnFocusElement: HTMLButtonElement | null) => void
}

function ArtifactCommentReplies({
	replies,
	rootId,
	currentUserId,
	editComment,
	activateThread,
	hoverThread,
	onRequestReplyDelete,
}: ArtifactCommentRepliesProps) {
	if (replies.length === 0) return null

	return (
		<div className="artifact-viewer-v2-comment-thread-replies">
			{replies.map((reply) => (
				<div key={reply.id} data-comment-reply-id={reply.id}>
					<ArtifactCommentReply
						authorName={reply.authorName}
						authorAvatarUrl={reply.authorAvatarUrl}
						createdAt={reply.createdAt}
						contentText={reply.contentText}
						createdByAgent={reply.createdByAgent}
						commentId={reply.id}
						contentJson={reply.contentJson}
						onEditComment={
							reply.createdByUserId === currentUserId && !reply.createdByAgent ? editComment : undefined
						}
						onDelete={
							reply.createdByUserId === currentUserId && !reply.createdByAgent
								? (returnFocusElement) => onRequestReplyDelete(reply.id, returnFocusElement)
								: undefined
						}
						active={false}
						onActivate={() => activateThread(rootId, { reveal: 'document' })}
						onHoverChange={(hovering) => hoverThread(hovering ? rootId : null)}
					/>
				</div>
			))}
		</div>
	)
}

function WiredArtifactCommentThread({
	rootId,
	...props
}: Omit<ComponentProps<typeof ArtifactCommentThread>, 'active'> & {
	rootId: string
}) {
	const active = useArtifactCommentFocusStore((state) => isArtifactCommentRootActive(state, rootId))
	return <ArtifactCommentThread {...props} active={active} />
}

function noop() {}

/**
 * Inert snapshot of a just-resolved thread, kept in the rail only while the
 * CSS collapse animation plays. `onSettled` removes the snapshot when the
 * wrapper's own animation ends (reduced motion shortens it, never removes it).
 */
function DismissingCommentThread({ thread, onSettled }: { thread: ProjectedCommentThread; onSettled: () => void }) {
	return (
		<div
			className="artifact-viewer-v2-comment-thread-dismissal"
			aria-hidden
			onAnimationEnd={(event) => {
				if (event.animationName.startsWith('artifact-viewer-v2-comment-thread-dismissal')) onSettled()
			}}
		>
			<div>
				<ArtifactCommentThread
					authorName={thread.authorName}
					authorAvatarUrl={thread.authorAvatarUrl}
					createdAt={thread.root.created_at}
					contentText={thread.root.content_text}
					kind={toCommentKind(thread.root.kind)}
					active={false}
					outdated={thread.placement.status === 'outdated'}
					originalText={
						thread.placement.status === 'outdated' ? originalAnchorText(thread.root.anchor_json) : null
					}
					onActivate={noop}
					onHoverChange={noop}
				>
					<ArtifactCommentReplies
						replies={thread.replies}
						rootId={thread.root.id}
						currentUserId={undefined}
						editComment={noop}
						activateThread={noop}
						hoverThread={noop}
						onRequestReplyDelete={noop}
					/>
				</ArtifactCommentThread>
			</div>
		</div>
	)
}

/**
 * Adapts the synced V2 threads to shared `ArtifactCommentThread` children inside
 * the `ArtifactReviewRail` shell. Composes the Open / Resolved / All filter,
 * open and resolved threads (Outdated ones labeled, with their original text),
 * and each thread's flattened replies + single reply composer. All interleaves
 * both in rail order. Activation reveals/scrolls the
 * counterpart document block; Resolve / Reopen delegate to the controller
 * view-model (the server cascades the whole thread). The filter is remembered
 * per artifact for the browser session.
 * Receives the controller view-model fields as props (one-hop) from the Wired
 * `ArtifactViewerV2`. Every OPEN root thread additionally composes one Wired
 * copy-only per-thread delivery control (Phase 10); resolved threads render
 * none.
 */
export function ArtifactCommentRail({
	children,
	artifactId,
	fileName,
	threads,
	resolvedThreads,
	activateThread,
	hoverThread,
	railRef,
	replyComposerRootId,
	openReplyComposer,
	closeReplyComposer,
	submitReply,
	resolveThread,
	reopenThread,
	currentUserDisplayName,
	currentUserAvatarUrl,
	currentUserId,
	editComment,
	deleteComment,
	deepLinkReveal,
	onDeepLinkRevealApplied,
	copyThreadLink,
}: ArtifactCommentRailProps) {
	const [storedVisibility, setVisibility] = useCommentVisibilityPreference(artifactId)
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
	const [deletePending, setDeletePending] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
	const requestReplyDelete = useCallback((commentId: string, returnFocusElement: HTMLButtonElement | null) => {
		deleteReturnFocusRef.current = returnFocusElement
		setDeleteError(null)
		setDeleteTarget({ commentId, memberIds: [commentId], target: 'reply', replyCount: 0 })
	}, [])

	// --- route-driven deep-link reveal (Phase 4) ---
	// The filter applies DURING render (same-commit derived state) so the
	// target card is in the DOM when the keyed reveal ref below fires. A
	// filter that already shows the target's bucket stays; otherwise the rail
	// switches to that bucket and the reveal ref remembers it.
	const visibility = deepLinkReveal
		? visibilityRevealing(storedVisibility, deepLinkReveal.visibility)
		: storedVisibility
	// Keyed span ref: fires once per reveal nonce, after the filter commit.
	// Resolves the rail from the span itself because child refs attach before the
	// rail shell's own ref on a same-commit rail mount.
	// Remembering the revealed filter re-renders the rail before the caller
	// clears the reveal; apply each nonce once.
	const revealedNonceRef = useRef<number | null>(null)
	const applyDeepLinkReveal = (node: HTMLSpanElement | null) => {
		if (!node || !deepLinkReveal || revealedNonceRef.current === deepLinkReveal.nonce) return
		revealedNonceRef.current = deepLinkReveal.nonce
		const rail = node.closest('.artifact-viewer-v2-review-rail') ?? railRef.current
		const rootCard = rail?.querySelector(`[data-thread-root-id="${CSS.escape(deepLinkReveal.rootId)}"]`)
		const replyCard = deepLinkReveal.replyId
			? rootCard?.querySelector(`[data-comment-reply-id="${CSS.escape(deepLinkReveal.replyId)}"]`)
			: null
		const target = replyCard ?? rootCard
		if (target instanceof HTMLElement) revealDeepLinkTarget(target)
		if (visibility !== storedVisibility) setVisibility(visibility)
		onDeepLinkRevealApplied()
	}

	async function confirmDelete() {
		if (!deleteTarget || deletePending) return
		setDeletePending(true)
		setDeleteError(null)
		try {
			await deleteComment({ commentId: deleteTarget.commentId, memberIds: deleteTarget.memberIds })
			setDeleteTarget(null)
		} catch {
			setDeleteError(`Failed to delete ${deleteTarget.target === 'root' ? 'thread' : 'reply'}. Try again.`)
		} finally {
			setDeletePending(false)
		}
	}

	function setDeleteDialogOpen(open: boolean) {
		if (open || deletePending) return
		setDeleteTarget(null)
		setDeleteError(null)
	}

	// Membership follows completion only; Outdated threads keep their label.
	// All interleaves open and resolved threads in rail order.
	const shownThreads = visibleThreads(threads, resolvedThreads, visibility)

	// --- resolve-dismissal animation ---
	// Threads that just resolved (send-and-resolve, resolve all, or a single
	// Resolve) keep an inert snapshot in the rail while its collapse animation
	// plays. Detection is same-commit derived state, comparing this render's
	// visible id list against the previous one; the snapshot's animationend
	// handler removes it.
	const [dismissing, setDismissing] = useState<DismissingThread[]>([])
	const visibleKey = shownThreads.map((thread) => thread.root.id).join('\n')
	const [previousVisible, setPreviousVisible] = useState<{
		key: string
		threads: readonly ProjectedCommentThread[]
	}>({ key: visibleKey, threads: shownThreads })
	if (previousVisible.key !== visibleKey) {
		setPreviousVisible({ key: visibleKey, threads: shownThreads })
		const visibleRootIds = new Set(shownThreads.map((thread) => thread.root.id))
		const resolvedRootIds = new Set(resolvedThreads.map((thread) => thread.root.id))
		const dismissed = collectDismissedThreads(previousVisible.threads, visibleRootIds, resolvedRootIds)
		// Hiding the open feed (Resolved only) is filtering, not resolution.
		setDismissing((current) =>
			visibility === 'resolved'
				? []
				: [
						// A thread that reappears (reopened mid-animation) stops dismissing.
						...current.filter((entry) => !visibleRootIds.has(entry.thread.root.id)),
						...dismissed.filter(
							(entry) => !current.some((existing) => existing.thread.root.id === entry.thread.root.id),
						),
					],
		)
	}
	const settleDismissal = useCallback((rootId: string) => {
		setDismissing((current) => current.filter((entry) => entry.thread.root.id !== rootId))
	}, [])
	const railThreads = mergeDismissingThreads(shownThreads, visibility === 'resolved' ? [] : dismissing)
	const emptyLabel = commentVisibilityEmptyLabel(visibility, {
		open: threads.length,
		resolved: resolvedThreads.length,
	})

	const renderResolvedThread = (thread: ProjectedCommentThread) => (
		<div key={thread.root.id} data-thread-root-id={thread.root.id}>
			<ArtifactCommentThread
				authorName={thread.authorName}
				authorAvatarUrl={thread.authorAvatarUrl}
				createdAt={thread.root.created_at}
				contentText={thread.root.content_text}
				commentId={thread.root.id}
				contentJson={thread.root.content_json}
				onEditComment={
					thread.root.created_by_user_id === currentUserId && !thread.root.created_by_agent
						? editComment
						: undefined
				}
				onDelete={
					thread.root.created_by_user_id === currentUserId && !thread.root.created_by_agent
						? (returnFocusElement) => {
								deleteReturnFocusRef.current = returnFocusElement
								setDeleteError(null)
								setDeleteTarget({
									commentId: thread.root.id,
									memberIds: [thread.root.id, ...thread.replies.map((reply) => reply.id)],
									target: 'root',
									replyCount: thread.replies.length,
								})
							}
						: undefined
				}
				kind={toCommentKind(thread.root.kind)}
				active={false}
				outdated={thread.placement.status === 'outdated'}
				originalText={
					thread.placement.status === 'outdated' ? originalAnchorText(thread.root.anchor_json) : null
				}
				resolved
				onActivate={() => activateThread(thread.root.id, { reveal: 'rail' })}
				onHoverChange={() => {}}
				onReopen={() => reopenThread(thread.root.id)}
				onCopyLink={() => copyThreadLink(thread.root.id)}
			>
				<ArtifactCommentReplies
					replies={thread.replies}
					rootId={thread.root.id}
					currentUserId={currentUserId}
					editComment={editComment}
					activateThread={activateThread}
					hoverThread={hoverThread}
					onRequestReplyDelete={requestReplyDelete}
				/>
			</ArtifactCommentThread>
		</div>
	)

	return (
		<ArtifactReviewRail
			ref={railRef}
			// Under Resolved every card is resolved, so the rail drops the
			// resolved dimming that tells resolved cards apart under All.
			className={visibility === 'resolved' ? 'artifact-viewer-v2-review-rail-resolved-only' : undefined}
		>
			<CommentVisibilityToggle value={visibility} onChange={setVisibility} />
			{children}
			{emptyLabel && railThreads.length === 0 ? (
				<p className="artifact-viewer-v2-review-rail-empty">{emptyLabel}</p>
			) : null}
			{railThreads.map(({ thread, dismissing: isDismissing }) => {
				if (isDismissing) {
					return (
						<DismissingCommentThread
							key={thread.root.id}
							thread={thread}
							onSettled={() => settleDismissal(thread.root.id)}
						/>
					)
				}
				if (isThreadResolved(thread)) return renderResolvedThread(thread)
				const composerOpen = replyComposerRootId === thread.root.id
				const outdated = thread.placement.status === 'outdated'
				const approximate = outdated && thread.approximate != null
				return (
					<div key={thread.root.id} data-thread-root-id={thread.root.id}>
						<WiredArtifactCommentThread
							rootId={thread.root.id}
							authorName={thread.authorName}
							authorAvatarUrl={thread.authorAvatarUrl}
							createdAt={thread.root.created_at}
							contentText={thread.root.content_text}
							commentId={thread.root.id}
							contentJson={thread.root.content_json}
							onEditComment={
								thread.root.created_by_user_id === currentUserId && !thread.root.created_by_agent
									? editComment
									: undefined
							}
							onDelete={
								thread.root.created_by_user_id === currentUserId && !thread.root.created_by_agent
									? (returnFocusElement) => {
											deleteReturnFocusRef.current = returnFocusElement
											setDeleteError(null)
											setDeleteTarget({
												commentId: thread.root.id,
												memberIds: [thread.root.id, ...thread.replies.map((reply) => reply.id)],
												target: 'root',
												replyCount: thread.replies.length,
											})
										}
									: undefined
							}
							kind={toCommentKind(thread.root.kind)}
							outdated={outdated}
							originalText={outdated ? originalAnchorText(thread.root.anchor_json) : null}
							onJumpTo={
								outdated && !approximate
									? undefined
									: () => activateThread(thread.root.id, { reveal: 'document' })
							}
							jumpApproximate={approximate}
							onActivate={() => activateThread(thread.root.id, { reveal: 'document' })}
							onHoverChange={(hovering) => hoverThread(hovering ? thread.root.id : null)}
							onReply={composerOpen ? undefined : () => openReplyComposer(thread.root.id)}
							onResolve={() => resolveThread(thread.root.id)}
							onCopyLink={() => copyThreadLink(thread.root.id)}
							deliveryControl={
								<ArtifactThreadDelivery artifactId={artifactId} fileName={fileName} thread={thread} />
							}
						>
							<ArtifactCommentReplies
								replies={thread.replies}
								rootId={thread.root.id}
								currentUserId={currentUserId}
								editComment={editComment}
								activateThread={activateThread}
								hoverThread={hoverThread}
								onRequestReplyDelete={requestReplyDelete}
							/>
							{composerOpen && (
								<ReplyComposer
									rootCommentId={thread.root.id}
									onSubmit={(contentText) => submitReply(thread.root.id, contentText)}
									onDismiss={closeReplyComposer}
									currentUserDisplayName={currentUserDisplayName}
									currentUserAvatarUrl={currentUserAvatarUrl}
								/>
							)}
						</WiredArtifactCommentThread>
					</div>
				)
			})}
			{deepLinkReveal ? <span key={deepLinkReveal.nonce} ref={applyDeepLinkReveal} hidden /> : null}
			<HotkeyScopeBoundary
				scope={HOTKEY_SCOPES.ARTIFACT_COMMENT_DELETE_DIALOG}
				isActive={deleteTarget !== null}
				rootScopeDisabled={true}
				componentName="ArtifactCommentDeleteDialog"
			>
				<ArtifactCommentDeleteDialog
					open={deleteTarget !== null}
					onOpenChange={setDeleteDialogOpen}
					onConfirm={confirmDelete}
					target={deleteTarget?.target ?? 'reply'}
					replyCount={deleteTarget?.replyCount}
					pending={deletePending}
					error={deleteError}
					returnFocusRef={deleteReturnFocusRef}
					hotkeyScope={HOTKEY_SCOPES.ARTIFACT_COMMENT_DELETE_DIALOG}
				/>
			</HotkeyScopeBoundary>
		</ArtifactReviewRail>
	)
}
