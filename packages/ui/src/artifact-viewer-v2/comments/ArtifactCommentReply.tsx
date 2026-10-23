import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useCallback, useState } from 'react'

import { AgentAvatarStack } from '../../components/agent-avatar-stack'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/avatar'
import { formatRelativeTime, getInitials } from '../../lib/comment-utils'
import { cn } from '../../lib/utils'
import { ArtifactCommentEditForm } from '../compose/ArtifactCommentEditForm'
import { MarkdownRenderer } from '../../components/markdown-renderer'
import { ArtifactCommentActionsMenu } from './ArtifactCommentActionsMenu'
import type { ArtifactCommentEditInput } from './ArtifactCommentThread'
import { UnverifiedIdentityBadge } from './UnverifiedIdentityBadge'

export interface ArtifactCommentReplyProps {
	authorName: string
	/** Null when the author has no avatar; the fallback renders initials. */
	authorAvatarUrl: string | null
	createdAt: bigint
	/** Reply body (markdown source, rendered as pre-wrapped text). */
	contentText: string
	/**
	 * Agent-authored reply (via the daemon `reply_to_artifact_comment` tool). It
	 * uses the shared human/agent avatar stack; humans author roots, agents only reply.
	 */
	createdByAgent: boolean
	isUnverified?: boolean
	onInspectIdentity?: () => void
	/** Transient active emphasis, mirrored with the root's document highlight. */
	active: boolean
	/** Activating a reply activates/scrolls the root annotation (replies carry no anchor). */
	onActivate: () => void
	onHoverChange: (hovering: boolean) => void
	commentId?: string
	contentJson?: ArtifactComment['content_json']
	onEditComment?: (input: ArtifactCommentEditInput) => unknown
	onDelete?: (returnFocusElement: HTMLButtonElement | null) => void
}

/**
 * Compact reply presentation beneath a root thread card: author identity,
 * timestamp, body, agent identity, and transient active styling. A reply
 * has no anchor of its own, so activating it delegates to the root thread's
 * document target.
 */
export function ArtifactCommentReply({
	authorName,
	authorAvatarUrl,
	createdAt,
	contentText,
	createdByAgent,
	isUnverified,
	onInspectIdentity,
	active,
	onActivate,
	onHoverChange,
	commentId,
	contentJson = null,
	onEditComment,
	onDelete,
}: ArtifactCommentReplyProps) {
	const [editing, setEditing] = useState(false)
	const [editPending, setEditPending] = useState(false)
	const [editError, setEditError] = useState<string | null>(null)
	const submitEdit = useCallback(
		async (input: ArtifactCommentEditInput) => {
			if (!onEditComment || editPending) return false
			setEditPending(true)
			setEditError(null)
			try {
				await onEditComment(input)
				return true
			} catch {
				setEditError('Failed to save edit. Try again.')
				return false
			} finally {
				setEditPending(false)
			}
		},
		[editPending, onEditComment],
	)
	return (
		<article
			className={cn('artifact-viewer-v2-comment-reply', active && 'artifact-viewer-v2-comment-reply-active')}
			onMouseEnter={() => onHoverChange(true)}
			onMouseLeave={() => onHoverChange(false)}
		>
			{(onEditComment || onDelete) && commentId && !editing ? (
				<div className="artifact-viewer-v2-comment-actions-slot">
					<ArtifactCommentActionsMenu
						onEdit={
							onEditComment
								? () => {
									setEditError(null)
									setEditing(true)
								}
								: undefined
						}
						onDelete={onDelete}
					/>
				</div>
			) : null}
			<div
				role="button"
				tabIndex={0}
				aria-pressed={active}
				className="artifact-viewer-v2-comment-reply-target"
				onClick={onActivate}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						onActivate()
					}
				}}
			>
				<header className="artifact-viewer-v2-comment-reply-header">
					{createdByAgent ? (
						<AgentAvatarStack
							authorDisplayName={authorName}
							authorAvatarUrl={authorAvatarUrl ?? undefined}
							authorFallbackId={authorName}
							avatarClassName="size-4"
						/>
					) : (
						<Avatar className="size-4">
							<AvatarImage src={authorAvatarUrl ?? undefined} alt={authorName} />
							<AvatarFallback className="text-[8px]">{getInitials(authorName)}</AvatarFallback>
						</Avatar>
					)}
					<span className="artifact-viewer-v2-comment-reply-author">{authorName}</span>
					{isUnverified ? <UnverifiedIdentityBadge onInspect={onInspectIdentity} /> : null}
					<span className="artifact-viewer-v2-comment-reply-time">{formatRelativeTime(createdAt)}</span>
				</header>
				{!editing ? <div className="artifact-viewer-v2-comment-reply-body"><MarkdownRenderer content={contentText} variant="pretty" preserveSingleLineBreaks /></div> : null}
			</div>
			{onEditComment && commentId ? (
				<ArtifactCommentEditForm
					commentId={commentId}
					initialText={contentText}
					contentJson={contentJson}
					editing={editing}
					pending={editPending}
					error={editError}
					onStartEditing={() => setEditing(true)}
					onCancel={() => {
						setEditing(false)
						setEditError(null)
					}}
					onSubmit={submitEdit}
				/>
			) : null}
		</article>
	)
}
