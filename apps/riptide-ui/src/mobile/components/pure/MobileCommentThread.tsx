import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { AgentAvatarStack } from '@humanlayer/ui/components/agent-avatar-stack'
import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import { useDraftField } from '@humanlayer/ui/hooks/use-draft-field'
import { formatRelativeTime, getInitials } from '@humanlayer/ui/lib/comment-utils'
import { draftSessionStorageKeys } from '@humanlayer/ui/lib/draft-session-storage-keys'
import { cn } from '@humanlayer/ui/lib/utils'
import { ArrowUpRight, Pencil, Trash2 } from 'lucide-react'
import { type FC, type ReactNode, useCallback, useState } from 'react'

import { MobileCommentComposer } from '@/mobile/components/pure/MobileCommentComposer'
export interface MobileCommentUserInfo {
	displayName?: string
	avatarUrl?: string
}

export interface MobileCommentThreadProps {
	rootComment: ArtifactComment
	replies: ArtifactComment[]
	currentUserId: string
	userLookup?: Map<string, MobileCommentUserInfo>
	onReply: (parentCommentId: string, contentText: string) => void
	onEdit: (commentId: string, contentText: string) => void
	onDelete: (commentId: string) => void
	/** Show the anchored block text above the thread (for list views where the
	 * commented section isn't visible/highlighted on screen). */
	showAnchorContext?: boolean
	/** When set (with showAnchorContext), the anchored quote block becomes a tap
	 * target that jumps to the commented section — the caller closes the drawer
	 * and scrolls the artifact to the block. */
	onJumpToBlock?: () => void
	/** V2 anchor quote shown in list mode. Empty atom anchors use a generated label. */
	anchorText?: string
	/** Whether the V2 anchor still resolves against the current document. */
	anchorStatus?: 'resolved' | 'outdated'
	/** Thread has activity from the agent or another user that the current user
	 * hasn't viewed yet — renders an accent marker on the root row. */
	isUnread?: boolean
	/** Inline "resolved" badge on the root row. Off in the all-comments list,
	 * where resolved threads are already grouped under a section header. */
	showResolvedBadge?: boolean
	/** Thread-level action buttons (resolve, copy, send to agent), rendered
	 * right-aligned between the comments and the reply composer so each thread
	 * carries its own scrollable action set. */
	actions?: ReactNode
	className?: string
}

/** Text action button with a ≥44px tap target (mobile) — used for edit-mode Save/Cancel */
const actionButtonClass =
	'flex min-h-11 items-center px-2 text-xs text-muted-foreground hover:text-foreground active:bg-accent/10 transition-colors'

/** Icon action button with a 44px tap target (mobile); same icons as desktop's CommentCard */
const iconButtonClass =
	'flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-foreground active:bg-accent/10 transition-colors'

interface MobileCommentRowProps {
	comment: ArtifactComment
	isReply?: boolean
	isUnread?: boolean
	showResolvedBadge?: boolean
	currentUserId: string
	userLookup?: Map<string, MobileCommentUserInfo>
	onEdit: (commentId: string, contentText: string) => void
	onDelete: (commentId: string) => void
}

const MobileCommentRow: FC<MobileCommentRowProps> = ({
	comment,
	isReply = false,
	isUnread = false,
	showResolvedBadge = true,
	currentUserId,
	userLookup,
	onEdit,
	onDelete,
}) => {
	const [isEditing, setIsEditing] = useState(false)
	const [editValue, setEditValue] = useState('')
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

	const author = userLookup?.get(comment.created_by_user_id)
	const displayName = author?.displayName ?? comment.created_by_user_id
	// Agent comments carry the driving user's id — attribute them inline
	// ("Anna's agent") since mobile has no hover tooltip.
	const authorLabel = comment.created_by_agent ? `${displayName}'s agent` : displayName
	const isOwn = comment.created_by_user_id === currentUserId && !comment.created_by_agent

	// Focus the edit textarea when it mounts, cursor at end (callback ref, no effect)
	const focusTextarea = useCallback((el: HTMLTextAreaElement | null) => {
		if (el) {
			el.focus()
			const len = el.value.length
			el.setSelectionRange(len, len)
		}
	}, [])

	const startEditing = () => {
		setEditValue(comment.content_text)
		setIsConfirmingDelete(false)
		setIsEditing(true)
	}

	const submitEdit = () => {
		const trimmed = editValue.trim()
		if (trimmed && trimmed !== comment.content_text) {
			onEdit(comment.id, trimmed)
		}
		setIsEditing(false)
	}

	const handleDeleteClick = () => {
		if (isConfirmingDelete) {
			onDelete(comment.id)
			setIsConfirmingDelete(false)
		} else {
			setIsConfirmingDelete(true)
		}
	}

	return (
		<div className="py-1.5">
			{/* Name row: identity on the left, own-comment actions (edit, delete)
			    on the right. Negative margins keep the 44px targets from
			    inflating the row height. */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					{comment.created_by_agent ? (
						/* Same 2-avatar treatment as desktop's CommentCard */
						<AgentAvatarStack
							authorDisplayName={author?.displayName}
							authorAvatarUrl={author?.avatarUrl}
							authorFallbackId={comment.created_by_user_id}
							avatarClassName="size-5"
							withTooltip={false}
						/>
					) : (
						<Avatar className="size-5 shrink-0">
							<AvatarImage
								src={author?.avatarUrl ?? ''}
								alt={displayName}
								className="absolute inset-0 object-cover"
							/>
							<AvatarFallback className="text-[8px]">{getInitials(displayName)}</AvatarFallback>
						</Avatar>
					)}
					<span className="truncate text-sm font-medium">{authorLabel}</span>
					<span className="shrink-0 text-xs text-muted-foreground">
						{formatRelativeTime(comment.created_at)}
					</span>
					{!isReply && showResolvedBadge && comment.is_resolved && (
						<span className="shrink-0 text-xs text-[var(--terminal-success)]">resolved</span>
					)}
					{!isReply && isUnread && (
						<span className="size-1.5 shrink-0 bg-[var(--terminal-accent)]" aria-label="New activity" />
					)}
				</div>
				{isOwn && !isEditing && (
					<div className="-my-3 -mr-3.5 flex shrink-0 items-center">
						<button
							type="button"
							className={iconButtonClass}
							onClick={startEditing}
							aria-label="Edit comment"
						>
							<Pencil className="h-3.5 w-3.5" />
						</button>
						<button
							type="button"
							className={cn(iconButtonClass, isConfirmingDelete && 'text-destructive')}
							onClick={handleDeleteClick}
							aria-label={isConfirmingDelete ? 'Tap again to confirm delete' : 'Delete comment'}
						>
							<Trash2 className="h-3.5 w-3.5" />
							{isConfirmingDelete && <span className="ml-1 text-xs">confirm?</span>}
						</button>
					</div>
				)}
			</div>

			{/* Body aligned under the name column, Notion-style */}
			<div className="pl-7">
				{isEditing ? (
					<div className="pt-1">
						<textarea
							ref={focusTextarea}
							value={editValue}
							onChange={(event) => setEditValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
									event.preventDefault()
									submitEdit()
								}
							}}
							rows={2}
							aria-label="Edit comment"
							className="field-sizing-content min-h-11 w-full resize-none border-0 bg-muted/40 px-2 py-1.5 text-base placeholder:text-muted-foreground/40 focus:outline-none"
						/>
						<div className="-ml-2 flex items-center">
							<button type="button" className={cn(actionButtonClass, 'text-accent')} onClick={submitEdit}>
								Save
							</button>
							<button type="button" className={actionButtonClass} onClick={() => setIsEditing(false)}>
								Cancel
							</button>
						</div>
					</div>
				) : (
					<div className="text-sm [&_.prose-terminal]:pb-0">
						<MarkdownRenderer content={comment.content_text} />
					</div>
				)}
			</div>
		</div>
	)
}

/**
 * Mobile-native comment thread, Notion-style: flat rows (no card border, no
 * separators), avatars aligned in one column, body text indented under the
 * name, and a single-row reply composer at the bottom. Comment-level actions
 * (edit/delete own) sit in each row's name line; thread-level actions
 * (resolve, copy, send to agent) come in via the `actions` slot.
 */
export const MobileCommentThread: FC<MobileCommentThreadProps> = ({
	rootComment,
	replies,
	currentUserId,
	userLookup,
	onReply,
	onEdit,
	onDelete,
	showAnchorContext = false,
	onJumpToBlock,
	anchorText,
	anchorStatus = 'resolved',
	isUnread = false,
	showResolvedBadge = true,
	actions,
	className,
}) => {
	// Same per-thread sessionStorage draft as desktop so an in-progress reply
	// survives the drawer closing or a reload.
	const replyDraft = useDraftField(draftSessionStorageKeys.reply(rootComment.id))
	const currentUser = userLookup?.get(currentUserId)

	const handleReplySubmit = (contentText: string) => {
		onReply(rootComment.id, contentText)
		replyDraft.clear()
	}

	return (
		<div className={className}>
			{/* Anchored block text — only for list views, where the commented
			    section isn't already visible on screen behind the drawer. With a
			    jump handler the whole quote is the tap target. */}
			{showAnchorContext &&
				anchorText &&
				(onJumpToBlock && anchorStatus === 'resolved' ? (
					<button
						type="button"
						onClick={onJumpToBlock}
						aria-label="Jump to the commented section"
						className="mb-1 flex w-full items-start gap-2 border-l-2 border-accent/80 pl-3 text-left transition-colors active:bg-accent/10"
					>
						<span className="line-clamp-2 min-w-0 flex-1 whitespace-pre-line font-mono text-sm text-muted-foreground">
							{anchorText}
						</span>
						<ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					</button>
				) : (
					<div className="mb-1 line-clamp-2 whitespace-pre-line border-l-2 border-accent/80 pl-3 font-mono text-sm text-muted-foreground">
						{anchorText}
					</div>
				))}
			{showAnchorContext && anchorStatus === 'outdated' && (
				<p className="mb-1 pl-3 text-xs text-[var(--terminal-warning)]">Outdated</p>
			)}
			<MobileCommentRow
				comment={rootComment}
				isUnread={isUnread}
				showResolvedBadge={showResolvedBadge}
				currentUserId={currentUserId}
				userLookup={userLookup}
				onEdit={onEdit}
				onDelete={onDelete}
			/>
			{replies.map((reply) => (
				<MobileCommentRow
					key={reply.id}
					comment={reply}
					isReply
					currentUserId={currentUserId}
					userLookup={userLookup}
					onEdit={onEdit}
					onDelete={onDelete}
				/>
			))}
			{/* Thread-level actions sit at the end of the conversation, before the
			    reply field. */}
			{actions && <div className="flex flex-wrap items-center justify-end gap-2 py-1.5">{actions}</div>}
			<MobileCommentComposer
				value={replyDraft.value}
				onChange={replyDraft.setValue}
				onSubmit={handleReplySubmit}
				placeholder="Reply..."
				authorDisplayName={currentUser?.displayName}
				authorAvatarUrl={currentUser?.avatarUrl}
			/>
		</div>
	)
}
