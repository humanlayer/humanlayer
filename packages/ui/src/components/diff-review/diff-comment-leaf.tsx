import { MoreHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { ProjectableDiffComment } from '../../lib/diff-review/project-diff-comments'
import { getInitials } from '../../lib/comment-utils'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'
import { formatCompactRelativeTime, formatLocalAbsoluteTime, parseTimestamp } from '../../lib/time-format'
import { useDraftField } from '../../hooks/use-draft-field'
import { AgentAvatarStack } from '../agent-avatar-stack'
import { Avatar, AvatarFallback, AvatarImage } from '../avatar'
import { Badge } from '../badge'
import { Button } from '../button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'
import { MarkdownRenderer } from '../markdown-renderer'

export interface DiffCommentLeafProps {
	readonly comment: ProjectableDiffComment
	readonly outdated?: boolean
	readonly currentUserId?: string
	readonly rootCommentId: string
	readonly onCopyLink?: (input: { rootCommentId: string }) => void
	readonly onEdit?: (input: { commentId: string; contentText: string; contentJson: string }) => Promise<boolean>
	readonly onDelete?: (input: { commentId: string }) => Promise<void> | void
}

function getAuthorName(comment: ProjectableDiffComment): string {
	const name = [comment.author?.firstName, comment.author?.lastName].filter(Boolean).join(' ')
	return name || comment.author?.email || 'Unknown author'
}

export function DiffCommentLeaf({ comment, outdated = false, currentUserId, rootCommentId, onCopyLink, onEdit, onDelete }: DiffCommentLeafProps) {
	const authorName = getAuthorName(comment)
	const createdAt = parseTimestamp(comment.created_at)
	const editDraft = useDraftField(draftSessionStorageKeys.diffCommentEdit(comment.id))
	const [editing, setEditing] = useState(false)
	const [pending, setPending] = useState(false)
	const canEdit = !comment.is_deleted && currentUserId === comment.created_by_user_id && Boolean(onEdit && onDelete)

	useEffect(() => {
		if (!comment.is_deleted) return
		setEditing(false)
		editDraft.clear()
	}, [comment.is_deleted, editDraft.clear])

	const submitEdit = async () => {
		const text = editDraft.value.trim()
		if (!text || !onEdit || pending) return
		setPending(true)
		const accepted = await onEdit({
			commentId: comment.id,
			contentText: text,
			contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }),
		})
		setPending(false)
		if (!accepted) return
		editDraft.clear()
		setEditing(false)
	}

	return (
		<div
			className="min-w-0 px-4 py-3 outline-none hover:bg-accent/10 focus:bg-[var(--terminal-warning)]/20"
			data-diff-comment-id={comment.id}
			tabIndex={-1}
		>
			<div className="mb-2 flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
				{/* In a narrow card the time and badges wrap below the author rather than squeezing the
				    name to nothing; the name keeps a few characters and an ellipsis at worst. */}
				<div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
					<div className="flex min-w-0 max-w-full items-center gap-2">
						{comment.created_by_agent ? (
							<AgentAvatarStack
								authorDisplayName={authorName}
								authorAvatarUrl={comment.author?.profilePictureUrl}
								authorFallbackId={comment.created_by_user_id}
								avatarClassName="size-5"
								className="shrink-0"
							/>
						) : (
							<Avatar className="size-5 shrink-0 border border-border">
								<AvatarImage src={comment.author?.profilePictureUrl ?? ''} alt={authorName} className="absolute inset-0 object-cover" />
								<AvatarFallback className="text-[8px]">{getInitials(authorName)}</AvatarFallback>
							</Avatar>
						)}
						<span className="min-w-[5ch] truncate font-medium text-foreground" title={authorName}>{authorName}</span>
					</div>
					<div className="flex min-w-0 items-center gap-2">
						<time className="shrink-0" dateTime={createdAt?.toISOString()} title={formatLocalAbsoluteTime(comment.created_at)}>
							{formatCompactRelativeTime(comment.created_at)}
						</time>
						{outdated ? (
							<Badge variant="outline" className="shrink-0 border-[var(--terminal-warning)]/50 text-[10px] uppercase text-[var(--terminal-warning)]">
								Outdated
							</Badge>
						) : null}
						{!editing && editDraft.value.trim() ? <span className="min-w-0 truncate italic">Edit in progress</span> : null}
					</div>
				</div>
				{!comment.is_deleted && (onCopyLink || canEdit) ? (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="ml-auto size-6 shrink-0" aria-label="Open comment actions">
								<MoreHorizontal className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{onCopyLink ? (
								<DropdownMenuItem onClick={() => onCopyLink({ rootCommentId })}>Copy link</DropdownMenuItem>
							) : null}
							{canEdit ? (
								<DropdownMenuItem onClick={() => {
									if (!editDraft.value.trim()) editDraft.setValue(comment.content_text)
									setEditing(true)
								}}>Edit</DropdownMenuItem>
							) : null}
							{canEdit ? (
								<DropdownMenuItem className="text-destructive" onClick={() => void onDelete?.({ commentId: comment.id })}>Delete</DropdownMenuItem>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				) : null}
			</div>
			{editing ? (
				<div>
					<textarea
						autoFocus
						value={editDraft.value}
						onChange={(event) => editDraft.setValue(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault()
								event.stopPropagation()
								setEditing(false)
							} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
								event.preventDefault()
								void submitEdit()
							}
						}}
						aria-label="Edit diff comment"
						className="min-h-16 w-full resize-y border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
					/>
					<div className="mt-2 flex flex-wrap justify-end gap-2">
						<Button type="button" variant="ghost" size="sm" onClick={() => {
							editDraft.clear()
							setEditing(false)
						}}>Discard</Button>
						<Button type="button" size="sm" disabled={pending || !editDraft.value.trim()} onClick={() => void submitEdit()}>
							{pending ? 'Saving...' : 'Save'}
						</Button>
					</div>
				</div>
			) : comment.is_deleted ? (
				<p className="text-sm italic text-muted-foreground">Comment deleted</p>
			) : (
				<>
					{/* The unlayered .prose-pretty stylesheet outranks layered utilities, so
					    the compact comment rhythm needs the important flag to apply. */}
					<div className="text-sm [&_.prose-pretty]:max-w-none [&_.prose-pretty]:!pb-0 [&_.prose-pretty]:!text-sm [&_.prose-pretty]:!leading-normal [&_.prose-pretty_p]:!my-0 [&_.prose-pretty_p]:!leading-normal">
						<MarkdownRenderer content={comment.content_text} variant="pretty" />
					</div>
				</>
			)}
		</div>
	)
}
