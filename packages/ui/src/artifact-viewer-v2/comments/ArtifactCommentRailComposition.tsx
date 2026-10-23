import type { ReactNode, RefObject } from 'react'

import type { CommentKind } from '../anchor/types'
import { ReplyComposer } from '../compose/ReplyComposer'
import { ArtifactCommentReply } from './ArtifactCommentReply'
import { ArtifactCommentThread, type ArtifactCommentEditInput } from './ArtifactCommentThread'
import { ArtifactReviewRail } from './ArtifactReviewRail'
import { type CommentVisibility, commentVisibilityEmptyLabel, visibleThreads } from './comment-visibility'
import { CommentVisibilityToggle } from './CommentVisibilityToggle'
import { originalAnchorText } from './original-text'
import type { ProjectedCommentThread } from './project-comments'
import { isThreadResolved } from './resolution'
import { type DismissingThread, mergeDismissingThreads } from './thread-dismissal'
import { UnverifiedIdentityBadge } from './UnverifiedIdentityBadge'

function toCommentKind(kind: string): CommentKind {
	return kind === 'deletion' || kind === 'approval' ? kind : 'comment'
}

export interface ArtifactCommentDeleteRequest {
	commentId: string
	memberIds: string[]
	target: 'reply' | 'root'
	replyCount: number
}

export interface ArtifactCommentRailCompositionProps {
	children?: ReactNode
	threads: ProjectedCommentThread[]
	resolvedThreads: ProjectedCommentThread[]
	visibility: CommentVisibility
	onVisibilityChange: (visibility: CommentVisibility) => void
	railRef?: RefObject<HTMLElement | null>
	replyComposerRootId: string | null
	openReplyComposer: (rootId: string) => void
	closeReplyComposer: () => void
	submitReply?: (rootCommentId: string, contentText: string) => Promise<boolean>
	/** Public viewers may reply directly; authenticated viewers reopen first. */
	canReplyToResolved?: boolean
	currentUserDisplayName?: string
	currentUserAvatarUrl?: string
	currentUserId?: string
	editComment?: (input: ArtifactCommentEditInput) => unknown
	canDeleteComment?: (input: { createdByUserId: string | null; createdByAgent: boolean; createdViaPublicShare: boolean }) => boolean
	onRequestDelete?: (request: ArtifactCommentDeleteRequest, returnFocusElement: HTMLButtonElement | null) => void
	onInspectGuestIdentity?: (commentId: string) => void
	isThreadActive?: (rootId: string) => boolean
	activateThread?: (rootId: string, options: { reveal: 'rail' | 'document' }) => void
	hoverThread?: (rootId: string | null) => void
	resolveThread?: (rootCommentId: string) => void
	reopenThread?: (rootCommentId: string) => void
	copyThreadLink?: (rootId: string) => void
	renderDeliveryControl?: (thread: ProjectedCommentThread) => ReactNode
	dismissingThreads?: DismissingThread[]
	onDismissalSettled?: (rootId: string) => void
	footer?: ReactNode
}

const noop = () => {}

interface ThreadContentProps {
	thread: ProjectedCommentThread
	resolved: boolean
	composerOpen: boolean
	props: ArtifactCommentRailCompositionProps
}

function ThreadContent({ thread, resolved, composerOpen, props }: ThreadContentProps) {
	const activateThread = props.activateThread ?? noop
	const hoverThread = props.hoverThread ?? noop
	const rootDeleteAllowed = props.canDeleteComment?.({
		createdByUserId: thread.root.created_by_user_id,
		createdByAgent: thread.root.created_by_agent,
		createdViaPublicShare: thread.root.created_via_public_share ?? false,
	})
	const canReply = Boolean(props.submitReply && (!resolved || props.canReplyToResolved))
	const outdated = thread.placement.status === 'outdated'
	const approximate = !resolved && outdated && thread.approximate != null

	return (
		<ArtifactCommentThread
			authorName={thread.authorName}
			authorAvatarUrl={thread.authorAvatarUrl}
			authorBadge={
				thread.isUnverified ? (
					<UnverifiedIdentityBadge
						onInspect={
							props.onInspectGuestIdentity ? () => props.onInspectGuestIdentity?.(thread.root.id) : undefined
						}
					/>
				) : undefined
			}
			createdAt={thread.root.created_at}
			contentText={thread.root.content_text}
			commentId={thread.root.id}
			contentJson={thread.root.content_json}
			onEditComment={
				thread.root.created_by_user_id === props.currentUserId && !thread.root.created_by_agent
					? props.editComment
					: undefined
			}
			onDelete={
				rootDeleteAllowed && props.onRequestDelete
					? (returnFocusElement) =>
							props.onRequestDelete?.(
								{
									commentId: thread.root.id,
									memberIds: [thread.root.id, ...thread.replies.map((reply) => reply.id)],
									target: 'root',
									replyCount: thread.replies.length,
								},
								returnFocusElement,
							)
					: undefined
			}
			kind={toCommentKind(thread.root.kind)}
			active={!resolved && Boolean(props.isThreadActive?.(thread.root.id))}
			outdated={outdated}
			originalText={outdated ? originalAnchorText(thread.root.anchor_json) : null}
			resolved={resolved}
			onJumpTo={
				!resolved && (!outdated || approximate) && props.activateThread
					? () => activateThread(thread.root.id, { reveal: 'document' })
					: undefined
			}
			jumpApproximate={approximate}
			onActivate={() => activateThread(thread.root.id, { reveal: resolved ? 'rail' : 'document' })}
			onHoverChange={resolved ? noop : (hovering) => hoverThread(hovering ? thread.root.id : null)}
			onReply={canReply && !composerOpen ? () => props.openReplyComposer(thread.root.id) : undefined}
			onResolve={!resolved && props.resolveThread ? () => props.resolveThread?.(thread.root.id) : undefined}
			onReopen={resolved && props.reopenThread ? () => props.reopenThread?.(thread.root.id) : undefined}
			onCopyLink={props.copyThreadLink ? () => props.copyThreadLink?.(thread.root.id) : undefined}
			deliveryControl={!resolved ? props.renderDeliveryControl?.(thread) : undefined}
		>
			{thread.replies.length > 0 ? (
				<div className="artifact-viewer-v2-comment-thread-replies">
					{thread.replies.map((reply) => {
						const replyDeleteAllowed = props.canDeleteComment?.({
							createdByUserId: reply.createdByUserId,
							createdByAgent: reply.createdByAgent,
							createdViaPublicShare: reply.createdViaPublicShare ?? false,
						})
						return (
							<div key={reply.id} data-comment-reply-id={reply.id}>
								<ArtifactCommentReply
									authorName={reply.authorName}
									authorAvatarUrl={reply.authorAvatarUrl}
									createdAt={reply.createdAt}
									contentText={reply.contentText}
									createdByAgent={reply.createdByAgent}
									isUnverified={reply.isUnverified}
									onInspectIdentity={
										reply.isUnverified && props.onInspectGuestIdentity
											? () => props.onInspectGuestIdentity?.(reply.id)
											: undefined
									}
									commentId={reply.id}
									contentJson={reply.contentJson}
									onEditComment={
										reply.createdByUserId === props.currentUserId && !reply.createdByAgent
											? props.editComment
											: undefined
									}
									onDelete={
										replyDeleteAllowed && props.onRequestDelete
											? (returnFocusElement) =>
													props.onRequestDelete?.(
														{
															commentId: reply.id,
															memberIds: [reply.id],
															target: 'reply',
															replyCount: 0,
														},
														returnFocusElement,
													)
											: undefined
									}
									active={false}
									onActivate={() => activateThread(thread.root.id, { reveal: 'document' })}
									onHoverChange={(hovering) => hoverThread(hovering ? thread.root.id : null)}
								/>
							</div>
						)
					})}
				</div>
			) : null}
			{composerOpen && props.submitReply && (!resolved || props.canReplyToResolved) ? (
				<ReplyComposer
					rootCommentId={thread.root.id}
					onSubmit={(contentText) => props.submitReply?.(thread.root.id, contentText) ?? Promise.resolve(false)}
					onDismiss={props.closeReplyComposer}
					currentUserDisplayName={props.currentUserDisplayName}
					currentUserAvatarUrl={props.currentUserAvatarUrl}
				/>
			) : null}
		</ArtifactCommentThread>
	)
}

function DismissingCommentThread({ thread, onSettled }: { thread: ProjectedCommentThread; onSettled: () => void }) {
	const inertProps: ArtifactCommentRailCompositionProps = {
		threads: [],
		resolvedThreads: [],
		visibility: 'open',
		onVisibilityChange: noop,
		replyComposerRootId: null,
		openReplyComposer: noop,
		closeReplyComposer: noop,
	}
	return (
		<div
			className="artifact-viewer-v2-comment-thread-dismissal"
			aria-hidden
			onAnimationEnd={(event) => {
				if (event.animationName.startsWith('artifact-viewer-v2-comment-thread-dismissal')) onSettled()
			}}
		>
			<div>
				<ThreadContent thread={thread} resolved={false} composerOpen={false} props={inertProps} />
			</div>
		</div>
	)
}

/** Shared rail/thread/reply composition used by authenticated and public adapters. */
export function ArtifactCommentRailComposition(props: ArtifactCommentRailCompositionProps) {
	const { threads, resolvedThreads, visibility } = props
	const railThreads = mergeDismissingThreads(
		visibleThreads(threads, resolvedThreads, visibility),
		visibility === 'resolved' ? [] : (props.dismissingThreads ?? []),
	)
	const emptyLabel = commentVisibilityEmptyLabel(visibility, {
		open: threads.length,
		resolved: resolvedThreads.length,
	})

	// Under Resolved every card is resolved, so the rail drops the resolved
	// dimming that tells resolved cards apart from open ones under All.
	return (
		<ArtifactReviewRail
			ref={props.railRef}
			className={visibility === 'resolved' ? 'artifact-viewer-v2-review-rail-resolved-only' : undefined}
		>
			<CommentVisibilityToggle value={visibility} onChange={props.onVisibilityChange} />
			{props.children}
			{emptyLabel && railThreads.length === 0 ? (
				<p className="artifact-viewer-v2-review-rail-empty">{emptyLabel}</p>
			) : null}
			{railThreads.map(({ thread, dismissing: isDismissing }) =>
				isDismissing ? (
					<DismissingCommentThread
						key={thread.root.id}
						thread={thread}
						onSettled={() => props.onDismissalSettled?.(thread.root.id)}
					/>
				) : (
					<div key={thread.root.id} data-thread-root-id={thread.root.id}>
						<ThreadContent
							thread={thread}
							resolved={isThreadResolved(thread)}
							composerOpen={props.replyComposerRootId === thread.root.id}
							props={props}
						/>
					</div>
				),
			)}
			{props.footer}
		</ArtifactReviewRail>
	)
}
