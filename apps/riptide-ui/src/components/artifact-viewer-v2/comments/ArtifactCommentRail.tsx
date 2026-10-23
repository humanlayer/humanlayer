import {
	ArtifactCommentDeleteDialog,
	ArtifactCommentRailComposition,
	collectDismissedThreads,
	isArtifactCommentRootActive,
	revealDeepLinkTarget,
	type ArtifactCommentDeleteRequest,
	type ArtifactCommentEditInput,
	type DismissingThread,
	type ProjectedCommentThread,
	useArtifactCommentFocusStore,
	useCommentVisibilityPreference,
	visibilityRevealing,
	visibleThreads,
} from '@humanlayer/ui/artifact-viewer-v2'
import { type ReactNode, type RefObject, useCallback, useRef, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

import type { ArtifactReviewDelivery } from '../ArtifactViewerV2'
import { ArtifactThreadDelivery } from '../delivery/ArtifactThreadDelivery'
import type { RailDeepLinkReveal } from '../useCommentDeepLink'

export interface ArtifactCommentRailProps {
	children?: ReactNode
	artifactId: string
	fileName: string
	/** Null: no per-thread delivery. */
	delivery: ArtifactReviewDelivery | null
	threads: ProjectedCommentThread[]
	resolvedThreads: ProjectedCommentThread[]
	activateThread: (rootId: string, options: { reveal: 'rail' | 'document' }) => void
	hoverThread: (rootId: string | null) => void
	railRef: RefObject<HTMLElement | null>
	replyComposerRootId: string | null
	openReplyComposer: (rootId: string) => void
	closeReplyComposer: () => void
	/** Undefined: read-only, no reply controls. */
	submitReply?: (rootCommentId: string, contentText: string) => Promise<boolean>
	/** Undefined: no resolve/reopen controls; resolved threads then take replies directly. */
	resolveThread?: (rootCommentId: string) => void
	reopenThread?: (rootCommentId: string) => void
	currentUserDisplayName: string | undefined
	currentUserAvatarUrl: string | undefined
	currentUserId: string | undefined
	editComment?: (input: ArtifactCommentEditInput) => unknown
	deleteComment?: (input: { commentId: string; memberIds?: string[] }) => unknown
	canModeratePublicComments?: boolean
	onInspectGuestIdentity?: (commentId: string) => void
	deepLinkReveal: RailDeepLinkReveal | null
	onDeepLinkRevealApplied: () => void
	copyThreadLink: (rootId: string) => void
}

/** Capability adapter over the shared comment rail composition, for signed-in and share-link reviews. */
export function ArtifactCommentRail({
	children,
	artifactId,
	fileName,
	delivery,
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
	canModeratePublicComments = false,
	onInspectGuestIdentity,
	deepLinkReveal,
	onDeepLinkRevealApplied,
	copyThreadLink,
}: ArtifactCommentRailProps) {
	const focusState = useArtifactCommentFocusStore()
	const [storedVisibility, setVisibility] = useCommentVisibilityPreference(artifactId)
	const [deleteTarget, setDeleteTarget] = useState<ArtifactCommentDeleteRequest | null>(null)
	const [deletePending, setDeletePending] = useState(false)
	const [deleteError, setDeleteError] = useState<string | null>(null)
	const deleteReturnFocusRef = useRef<HTMLElement | null>(null)
	// A pending reveal shows its target's bucket in the same commit; the reveal
	// ref below then remembers that filter like any other selection.
	const visibility = deepLinkReveal
		? visibilityRevealing(storedVisibility, deepLinkReveal.visibility)
		: storedVisibility

	const shownThreads = visibleThreads(threads, resolvedThreads, visibility)
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

	function requestDelete(request: ArtifactCommentDeleteRequest, returnFocusElement: HTMLButtonElement | null) {
		deleteReturnFocusRef.current = returnFocusElement
		setDeleteError(null)
		setDeleteTarget(request)
	}

	async function confirmDelete() {
		if (!deleteTarget || deletePending || !deleteComment) return
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

	return (
		<ArtifactCommentRailComposition
			threads={threads}
			resolvedThreads={resolvedThreads}
			visibility={visibility}
			onVisibilityChange={setVisibility}
			railRef={railRef}
			replyComposerRootId={replyComposerRootId}
			openReplyComposer={openReplyComposer}
			closeReplyComposer={closeReplyComposer}
			submitReply={submitReply}
			canReplyToResolved={!reopenThread}
			currentUserDisplayName={currentUserDisplayName}
			currentUserAvatarUrl={currentUserAvatarUrl}
			currentUserId={currentUserId}
			editComment={editComment}
			canDeleteComment={({ createdByUserId, createdByAgent, createdViaPublicShare }) =>
				!!deleteComment &&
				((createdByUserId === currentUserId && !createdByAgent) ||
					(createdViaPublicShare && canModeratePublicComments))
			}
			onRequestDelete={requestDelete}
			onInspectGuestIdentity={onInspectGuestIdentity}
			isThreadActive={(rootId) => isArtifactCommentRootActive(focusState, rootId)}
			activateThread={activateThread}
			hoverThread={hoverThread}
			resolveThread={resolveThread}
			reopenThread={reopenThread}
			copyThreadLink={copyThreadLink}
			renderDeliveryControl={
				delivery
					? (thread) => (
							<ArtifactThreadDelivery
								artifactId={artifactId}
								fileName={fileName}
								delivery={delivery}
								thread={thread}
							/>
						)
					: undefined
			}
			dismissingThreads={dismissing}
			onDismissalSettled={settleDismissal}
			footer={
				<>
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
				</>
			}
		>
			{children}
		</ArtifactCommentRailComposition>
	)
}
