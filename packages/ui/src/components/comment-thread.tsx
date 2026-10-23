import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { UnfoldVertical } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useDraftField } from '../hooks/use-draft-field'
import { formatThreadForLlm, type GetMarkdownContextForComment, getInitials } from '../lib/comment-utils'
import { draftSessionStorageKeys } from '../lib/draft-session-storage-keys'
import { cn } from '../lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { Button } from './button'
import { CommentCard } from './comment-card'
import { CommentEditor } from './comment-editor'

export interface UserInfo {
	displayName?: string
	avatarUrl?: string
}

const COLLAPSED_REPLIES_PER_END = 3

interface CommentThreadProps {
	/** Artifact filename for XML wrapper tag */
	artifactFilename?: string
	rootComment: ArtifactComment
	replies: ArtifactComment[]
	onReply: (parentCommentId: string, contentText: string, contentJson: string) => boolean | void
	onDelete: (commentId: string) => void
	onEdit?: (commentId: string, contentText: string, contentJson: string) => void
	onResolve?: (commentId: string) => void
	onUnresolve?: (commentId: string) => void
	onCollapse?: () => void
	currentUserId: string
	userLookup?: Map<string, UserInfo>
	/** Lazily resolve markdown block context for a comment */
	getMarkdownContextForComment?: GetMarkdownContextForComment
	/** Whether the root comment's anchor block could not be found in the current document */
	isOutdated?: boolean
	/** Called to append formatted comment text to agent input (riptide-ui only) */
	onAppendToAgentInput?: (text: string) => void
}

export function CommentThread({
	artifactFilename,
	rootComment,
	replies,
	onReply,
	onDelete,
	onEdit,
	onResolve,
	onUnresolve,
	onCollapse,
	currentUserId,
	userLookup,
	getMarkdownContextForComment,
	isOutdated,
	onAppendToAgentInput,
}: CommentThreadProps) {
	const [showAllReplies, setShowAllReplies] = useState(false)
	const [resolvedCollapsed, setResolvedCollapsed] = useState(rootComment.is_resolved)
	const [, copyToClipboard] = useCopyToClipboard()
	const editorRef = useRef<HTMLDivElement>(null)
	// Per-thread sessionStorage draft so an in-progress reply survives navigation/reload
	// and never bleeds across threads. Cleared only on submit or when emptied.
	const replyDraft = useDraftField(draftSessionStorageKeys.reply(rootComment.id))
	const authorId = (comment: ArtifactComment) =>
		comment.created_by_user_id ?? comment.anonymous_author_id ?? comment.id

	useLayoutEffect(() => {
		setResolvedCollapsed(rootComment.is_resolved)
	}, [rootComment.id, rootComment.is_resolved])

	const handleReply = (contentText: string, contentJson: string) => {
		const accepted = onReply(rootComment.id, contentText, contentJson)
		if (accepted === false) return
		replyDraft.clear()
	}

	const handleCopyThreadForLlm = () => {
		const formatted = formatThreadForLlm({
			artifactFilename,
			markdownContext: getMarkdownContextForComment?.(rootComment.id),
			rootComment: {
				id: rootComment.id,
				contentText: rootComment.content_text,
				isResolved: rootComment.is_resolved,
				createdByUserId: authorId(rootComment),
			},
			replies: replies.map((r) => ({
				id: r.id,
				contentText: r.content_text,
				isResolved: r.is_resolved,
				createdByUserId: authorId(r),
			})),
			userLookup,
		})
		copyToClipboard(formatted)
	}

	const handleSendThreadToAgent = useCallback(() => {
		const formatted = formatThreadForLlm({
			artifactFilename,
			markdownContext: getMarkdownContextForComment?.(rootComment.id),
			rootComment: {
				id: rootComment.id,
				contentText: rootComment.content_text,
				isResolved: rootComment.is_resolved,
				createdByUserId: authorId(rootComment),
			},
			replies: replies.map((r) => ({
				id: r.id,
				contentText: r.content_text,
				isResolved: r.is_resolved,
				createdByUserId: authorId(r),
			})),
			userLookup,
		})
		onAppendToAgentInput?.(formatted)
	}, [rootComment, replies, getMarkdownContextForComment, userLookup, onAppendToAgentInput, artifactFilename])

	const handleSendThreadToAgentAndResolve = useCallback(() => {
		handleSendThreadToAgent()
		if (onResolve) {
			onResolve(rootComment.id)
		}
	}, [handleSendThreadToAgent, onResolve, rootComment.id])

	const focusReplyEditor = () => {
		const el = editorRef.current?.querySelector<HTMLTextAreaElement>('textarea')
		if (el) {
			el.focus()
		}
	}

	const currentUser = userLookup?.get(currentUserId)
	const author = userLookup?.get(authorId(rootComment))
	const authorName = author?.displayName ?? rootComment.anonymous_guest_name ?? authorId(rootComment)

	if (rootComment.is_resolved && resolvedCollapsed) {
		return (
			<div className="rounded-md border overflow-hidden relative transition-colors duration-200 bg-card">
				<button
					type="button"
					className="flex w-full items-center gap-2 p-3 pr-10 text-left text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
					onClick={() => setResolvedCollapsed(false)}
				>
					<Avatar className="size-5 shrink-0 border border-border">
						<AvatarImage
							src={author?.avatarUrl ?? ''}
							alt={author?.displayName ?? ''}
							className="absolute inset-0 object-cover"
						/>
						<AvatarFallback className="text-[8px]">{getInitials(authorName)}</AvatarFallback>
					</Avatar>
					<span className="flex-1 truncate">This comment has been resolved.</span>
				</button>
				<div className="absolute top-2.5 right-2">
					<Button
						variant="secondary"
						size="icon"
						className="h-6 w-6"
						onClick={() => setResolvedCollapsed(false)}
						aria-label="Expand resolved comment"
					>
						<UnfoldVertical className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
		)
	}

	const shouldCollapse = replies.length > COLLAPSED_REPLIES_PER_END * 2
	const hiddenCount = replies.length - COLLAPSED_REPLIES_PER_END * 2

	const visibleReplies =
		shouldCollapse && !showAllReplies
			? [...replies.slice(0, COLLAPSED_REPLIES_PER_END), ...replies.slice(-COLLAPSED_REPLIES_PER_END)]
			: replies

	return (
		<div className={cn('rounded-md border overflow-hidden bg-card', rootComment.is_resolved && 'opacity-60')}>
			<div className="divide-y divide-border">
				<CommentCard
					artifactFilename={artifactFilename}
					comment={rootComment}
					onDelete={onDelete}
					onEdit={onEdit}
					onResolve={onResolve}
					onUnresolve={onUnresolve}
					onCollapse={rootComment.is_resolved
						? () => {
							setResolvedCollapsed(true)
							onCollapse?.()
						}
						: onCollapse}
					currentUserId={currentUserId}
					authorDisplayName={userLookup?.get(authorId(rootComment))?.displayName ?? rootComment.anonymous_guest_name ?? undefined}
					authorAvatarUrl={userLookup?.get(authorId(rootComment))?.avatarUrl}
					hideHighlightedText
					onHighlightClick={focusReplyEditor}
					onCopyThreadForLlm={replies.length > 0 ? handleCopyThreadForLlm : undefined}
					onSendThreadToAgent={onAppendToAgentInput && replies.length > 0 ? handleSendThreadToAgent : undefined}
					onSendThreadToAgentAndResolve={onAppendToAgentInput && replies.length > 0 ? handleSendThreadToAgentAndResolve : undefined}
					onAppendToAgentInput={onAppendToAgentInput}
					getMarkdownContextForComment={getMarkdownContextForComment}
					isOutdated={isOutdated}
				/>
				{shouldCollapse && !showAllReplies ? (
					<>
						{replies.slice(0, COLLAPSED_REPLIES_PER_END).map((reply) => (
							<CommentCard
								key={reply.id}
								artifactFilename={artifactFilename}
								comment={reply}
								onDelete={onDelete}
								onEdit={onEdit}
								currentUserId={currentUserId}
								authorDisplayName={userLookup?.get(authorId(reply))?.displayName ?? reply.anonymous_guest_name ?? undefined}
								authorAvatarUrl={userLookup?.get(authorId(reply))?.avatarUrl}
								isReply
							/>
						))}
						<button
							type="button"
							className="w-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 transition-colors text-center cursor-pointer"
							onClick={() => setShowAllReplies(true)}
						>
							{hiddenCount} more {hiddenCount === 1 ? 'reply' : 'replies'}
						</button>
						{replies.slice(-COLLAPSED_REPLIES_PER_END).map((reply) => (
							<CommentCard
								key={reply.id}
								artifactFilename={artifactFilename}
								comment={reply}
								onDelete={onDelete}
								onEdit={onEdit}
								currentUserId={currentUserId}
								authorDisplayName={userLookup?.get(authorId(reply))?.displayName ?? reply.anonymous_guest_name ?? undefined}
								authorAvatarUrl={userLookup?.get(authorId(reply))?.avatarUrl}
								isReply
							/>
						))}
					</>
				) : (
					visibleReplies.map((reply) => (
						<CommentCard
							key={reply.id}
							artifactFilename={artifactFilename}
							comment={reply}
							onDelete={onDelete}
							onEdit={onEdit}
							currentUserId={currentUserId}
							authorDisplayName={userLookup?.get(authorId(reply))?.displayName ?? reply.anonymous_guest_name ?? undefined}
							authorAvatarUrl={userLookup?.get(authorId(reply))?.avatarUrl}
							isReply
						/>
					))
				)}
			</div>
			<div className="border-t border-border" ref={editorRef}>
				<CommentEditor
					value={replyDraft.value}
					onChange={replyDraft.setValue}
					onSubmit={handleReply}
					placeholder="Reply..."
					currentUserDisplayName={currentUser?.displayName}
				/>
			</div>
		</div>
	)
}
