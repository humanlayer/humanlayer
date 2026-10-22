import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Check, FoldVertical, MoreHorizontal, Pencil, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useDraftField } from '../hooks/use-draft-field'
import { useMountEffect } from '../hooks/use-mount-effect'
import { formatCommentForLlm, formatRelativeTime, getInitials, type GetMarkdownContextForComment } from '../lib/comment-utils'
import { draftSessionStorageKeys } from '../lib/draft-session-storage-keys'
import { cn } from '../lib/utils'
import { AgentAvatarStack } from './agent-avatar-stack'
import { Avatar, AvatarFallback, AvatarImage } from './avatar'
import { Badge } from './badge'
import { Button } from './button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from './dropdown-menu'
import { KeyboardShortcut } from './keyboard-shortcut'
import { MarkdownRenderer } from './markdown-renderer'
import { TooltipContent } from './tooltip'

interface CommentCardProps {
	/** Artifact filename for XML wrapper tag */
	artifactFilename?: string
	comment: ArtifactComment
	onDelete?: (commentId: string) => void
	onEdit?: (commentId: string, contentText: string, contentJson: string) => void
	onResolve?: (commentId: string) => void
	onUnresolve?: (commentId: string) => void
	onCollapse?: () => void
	currentUserId: string
	authorDisplayName?: string
	authorAvatarUrl?: string
	isReply?: boolean
	/** Hide the highlighted text quote block (parent thread shows line badge instead) */
	hideHighlightedText?: boolean
	/** Called when the line badge is clicked to focus the reply editor */
	onHighlightClick?: () => void
	/** Called to copy entire thread for LLM (only shown on root comment with replies) */
	onCopyThreadForLlm?: () => void
	/** Lazily resolve markdown block context for a comment */
	getMarkdownContextForComment?: GetMarkdownContextForComment
	/** Whether the comment's anchor block could not be found in the current document */
	isOutdated?: boolean
	/** Called to append formatted comment text to agent input */
	onAppendToAgentInput?: (text: string) => void
	/** Called to send thread to agent (only shown on root with replies) */
	onSendThreadToAgent?: () => void
	/** Called to send thread to agent and resolve */
	onSendThreadToAgentAndResolve?: () => void
}

export function CommentCard({
	artifactFilename,
	comment,
	onDelete,
	onEdit,
	onResolve,
	onUnresolve,
	onCollapse,
	currentUserId,
	authorDisplayName,
	authorAvatarUrl,
	isReply = false,
	hideHighlightedText = false,
	onHighlightClick,
	onCopyThreadForLlm,
	getMarkdownContextForComment,
	isOutdated = false,
	onAppendToAgentInput,
	onSendThreadToAgent,
	onSendThreadToAgentAndResolve,
}: CommentCardProps) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [isExpanded, setIsExpanded] = useState(false)
	const [isClamped, setIsClamped] = useState(false)
	const [isEditing, setIsEditing] = useState(false)
	const contentRef = useRef<HTMLDivElement>(null)
	const isOwnComment = comment.created_by_user_id === currentUserId
	// Surface a passive "edit in progress" hint when an edit draft survived a
	// navigation/reload but we aren't currently in the editor. Reading the draft
	// reactively keeps the hint in sync when the editor saves or clears it.
	const editDraft = useDraftField(draftSessionStorageKeys.edit(comment.id))
	const hasEditDraft = editDraft.value.trim() !== ''

	const handleSubmitEdit = useCallback(
		(trimmed: string) => {
			if (!onEdit) return
			const json = JSON.stringify({
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text: trimmed }] }],
			})
			onEdit(comment.id, trimmed, json)
		},
		[onEdit, comment.id],
	)

	const relativeTime = useMemo(() => formatRelativeTime(comment.created_at), [comment.created_at])
	const authorFallback =
		comment.anonymous_guest_name ?? comment.created_by_user_id ?? comment.anonymous_author_id ?? 'Guest'

	const measureContentOverflow = (el: HTMLDivElement | null) => {
		;(contentRef as React.MutableRefObject<HTMLDivElement | null>).current = el
		if (el) {
			setIsClamped(el.scrollHeight > el.clientHeight)
		}
	}

	const handleSendCommentToAgent = useCallback(() => {
		const formatted = formatCommentForLlm({
			artifactFilename,
			commentId: comment.id,
			markdownContext: getMarkdownContextForComment?.(comment.id),
			authorName: authorDisplayName ?? authorFallback,
			commentText: comment.content_text,
			isResolved: comment.is_resolved,
		})
		onAppendToAgentInput?.(formatted)
	}, [comment, authorDisplayName, authorFallback, getMarkdownContextForComment, onAppendToAgentInput, artifactFilename])

	const handleSendCommentToAgentAndResolve = useCallback(() => {
		handleSendCommentToAgent()
		if (onResolve) {
			onResolve(comment.id)
		}
	}, [handleSendCommentToAgent, onResolve, comment.id])

	return (
		<div className="relative p-3">
			<div className="absolute top-2.5 right-2 flex items-center gap-0.5">
				{isOwnComment && onEdit && !isEditing && hasEditDraft && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation()
							setIsEditing(true)
						}}
						onPointerDown={(e) => e.stopPropagation()}
						className="mr-0.5 shrink-0 cursor-pointer rounded-sm border border-border/50 px-1.5 py-0.5 text-[10px] italic text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted/50 hover:text-foreground"
					>
						edit in progress
					</button>
				)}
				{isOwnComment && onEdit && (
					<TooltipPrimitive.Provider delayDuration={400}>
						<TooltipPrimitive.Root>
							<TooltipPrimitive.Trigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6"
									onClick={(e) => {
										e.stopPropagation()
										setIsEditing(true)
									}}
									onPointerDown={(e) => e.stopPropagation()}
								>
									<Pencil className="h-3.5 w-3.5" />
								</Button>
							</TooltipPrimitive.Trigger>
							<TooltipContent side="bottom">Edit</TooltipContent>
						</TooltipPrimitive.Root>
					</TooltipPrimitive.Provider>
				)}
				{onResolve && (
					<TooltipPrimitive.Provider delayDuration={400}>
						<TooltipPrimitive.Root>
							<TooltipPrimitive.Trigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-6 w-6"
									onClick={(e) => {
										e.stopPropagation()
										onResolve(comment.id)
									}}
									onPointerDown={(e) => e.stopPropagation()}
								>
									<Check className="h-3.5 w-3.5" />
								</Button>
							</TooltipPrimitive.Trigger>
							<TooltipContent side="bottom">Mark as resolved</TooltipContent>
						</TooltipPrimitive.Root>
					</TooltipPrimitive.Provider>
				)}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-6 w-6">
							<span className="sr-only">Open menu</span>
							<MoreHorizontal className="h-3.5 w-3.5" />
						</Button>
					</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => copyToClipboard(comment.content_text)}>
						Copy
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => {
						const formatted = formatCommentForLlm({
							artifactFilename,
							commentId: comment.id,
							markdownContext: getMarkdownContextForComment?.(comment.id),
							authorName: authorDisplayName ?? authorFallback,
							commentText: comment.content_text,
							isResolved: comment.is_resolved,
						})
						copyToClipboard(formatted)
					}}>
						Copy for Agent
					</DropdownMenuItem>
					{onCopyThreadForLlm && (
						<DropdownMenuItem onClick={onCopyThreadForLlm}>
							Copy Thread for Agent
						</DropdownMenuItem>
					)}
					{onAppendToAgentInput && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={handleSendCommentToAgent}>
								Send comment to agent
							</DropdownMenuItem>
							<DropdownMenuItem onClick={handleSendCommentToAgentAndResolve}>
								Send comment to agent and resolve
							</DropdownMenuItem>
							{onSendThreadToAgent && (
								<>
									<DropdownMenuItem onClick={onSendThreadToAgent}>
										Send thread to agent
									</DropdownMenuItem>
									<DropdownMenuItem onClick={onSendThreadToAgentAndResolve}>
										Send thread to agent and resolve
									</DropdownMenuItem>
								</>
							)}
						</>
					)}
					{onUnresolve && comment.is_resolved && (
						<DropdownMenuItem onClick={() => onUnresolve(comment.id)}>
							Unresolve
						</DropdownMenuItem>
					)}
					{isOwnComment && onDelete && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem className="text-destructive" onClick={() => onDelete(comment.id)}>
								Delete
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
				</DropdownMenu>
				{onCollapse && (
					<TooltipPrimitive.Provider delayDuration={400}>
						<TooltipPrimitive.Root>
							<TooltipPrimitive.Trigger asChild>
								<Button
									variant="secondary"
									size="icon"
									className="h-6 w-6 text-accent border-accent/50 bg-accent/10 hover:bg-accent/20"
									aria-label="Collapse comment"
									onClick={(e) => {
										e.stopPropagation()
										onCollapse()
									}}
									onPointerDown={(e) => e.stopPropagation()}
								>
									<FoldVertical className="h-3.5 w-3.5" />
								</Button>
							</TooltipPrimitive.Trigger>
							<TooltipContent side="bottom">Collapse</TooltipContent>
						</TooltipPrimitive.Root>
					</TooltipPrimitive.Provider>
				)}
			</div>
			<div className="flex items-center gap-2 mb-3 pr-14 min-w-0">
				{comment.created_by_agent ? (
					<AgentAvatarStack
						authorDisplayName={authorDisplayName}
						authorAvatarUrl={authorAvatarUrl}
						authorFallbackId={authorFallback}
						avatarClassName="size-5"
					/>
				) : (
					<Avatar className="size-5 shrink-0 border border-border">
						<AvatarImage src={authorAvatarUrl ?? ''} alt={authorDisplayName ?? ''} className="absolute inset-0 object-cover" />
						<AvatarFallback className="text-[8px]">
							{getInitials(authorDisplayName ?? authorFallback)}
						</AvatarFallback>
					</Avatar>
				)}
				<span className="text-sm font-medium truncate">{authorDisplayName ?? authorFallback}</span>
				<span className="text-xs text-muted-foreground shrink-0">{relativeTime}</span>
				{isOutdated && (
					<Badge
						variant="outline"
						className="text-[var(--terminal-warning)] border-[var(--terminal-warning)]/50 text-[10px] uppercase shrink-0"
					>
						OUTDATED
					</Badge>
				)}
			</div>

			{comment.commented_upon_block_text && !hideHighlightedText && (
				<button
					type="button"
					className="mb-2 pl-3 border-l-2 border-muted text-xs text-muted-foreground font-mono whitespace-pre-line line-clamp-4 text-left cursor-pointer hover:border-foreground/40 transition-colors w-full"
					onClick={onHighlightClick}
					title="Click to reply"
				>
					{comment.commented_upon_block_text}
				</button>
			)}

			{isEditing ? (
				<CommentEditForm
					commentId={comment.id}
					initialText={comment.content_text}
					isReply={isReply}
					onCancel={() => {
						setIsEditing(false)
					}}
					onSubmit={(trimmed) => {
						if (trimmed !== comment.content_text) {
							handleSubmitEdit(trimmed)
						}
						setIsEditing(false)
					}}
				/>
			) : (
				<>
					<div
						ref={measureContentOverflow}
						className={cn(
							'text-sm [&_.prose-terminal]:pb-0',
							isReply && 'pl-4',
							!isExpanded && 'line-clamp-6',
							isExpanded && 'max-h-[50vh] overflow-y-auto',
						)}
					>
						<MarkdownRenderer content={comment.content_text} />
					</div>
					{(isClamped || isExpanded) && (
						<button
							type="button"
							className="text-xs text-accent cursor-pointer hover:underline hover:text-accent/80 transition-colors mt-1"
							onClick={() => setIsExpanded((prev) => !prev)}
						>
							{isExpanded ? 'Show less' : 'Show more'}
						</button>
					)}
				</>
			)}
		</div>
	)
}

interface CommentEditFormProps {
	commentId: string
	initialText: string
	isReply: boolean
	onCancel: () => void
	onSubmit: (trimmed: string) => void
}

function CommentEditForm({ commentId, initialText, isReply, onCancel, onSubmit }: CommentEditFormProps) {
	// Per-comment sessionStorage draft so an in-progress edit survives navigation/reload.
	// Seed from the saved draft if present, otherwise the existing comment text.
	// Cleared only on submit or explicit Cancel/Discard.
	const editDraft = useDraftField(draftSessionStorageKeys.edit(commentId))
	// Seed once from the saved draft (else the existing comment text); after that the
	// editor owns its value so clearing the field stays empty rather than reverting.
	const [value, setValue] = useState(editDraft.value || initialText)
	const textareaRef = useRef<HTMLTextAreaElement | null>(null)

	const handleChange = useCallback(
		(next: string) => {
			setValue(next)
			editDraft.setValue(next)
		},
		[editDraft],
	)

	const handleCancel = useCallback(() => {
		editDraft.clear()
		onCancel()
	}, [editDraft, onCancel])

	const attachRef = useCallback((el: HTMLTextAreaElement | null) => {
		textareaRef.current = el
		if (el) {
			el.focus()
			const len = el.value.length
			el.setSelectionRange(len, len)
		}
	}, [])

	const handleSubmit = useCallback(() => {
		const trimmed = value.trim()
		if (!trimmed) {
			handleCancel()
			return
		}
		editDraft.clear()
		onSubmit(trimmed)
	}, [value, onSubmit, handleCancel, editDraft])

	// Capture-phase Escape handler to cancel edit before bubbling hotkeys close other UI
	useMountEffect(() => {
		const handleEscape = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && textareaRef.current === document.activeElement) {
				e.stopImmediatePropagation()
				e.preventDefault()
				handleCancel()
			}
		}
		document.addEventListener('keydown', handleEscape, { capture: true })
		return () => document.removeEventListener('keydown', handleEscape, { capture: true })
	})

	return (
		<div className={cn('flex items-end gap-1.5', isReply && 'pl-4')}>
			<textarea
				ref={attachRef}
				value={value}
				onChange={(e) => handleChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
						e.preventDefault()
						handleSubmit()
					}
				}}
				rows={3}
				className="min-w-0 flex-1 resize-none border border-input bg-background px-2 py-1 text-sm placeholder:text-muted-foreground/40 focus:outline-none field-sizing-content overflow-y-auto min-h-[4.5rem]"
			/>
			<TooltipPrimitive.Provider delayDuration={400}>
				<TooltipPrimitive.Root>
					<TooltipPrimitive.Trigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 shrink-0 mb-[2px]"
							onClick={handleCancel}
						>
							<X className="h-3.5 w-3.5" />
						</Button>
					</TooltipPrimitive.Trigger>
					<TooltipContent side="bottom">
						<p className="flex items-center gap-1">
							Cancel <KeyboardShortcut size="xs">ESC</KeyboardShortcut>
						</p>
					</TooltipContent>
				</TooltipPrimitive.Root>
			</TooltipPrimitive.Provider>
			<TooltipPrimitive.Provider delayDuration={400}>
				<TooltipPrimitive.Root>
					<TooltipPrimitive.Trigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-6 w-6 shrink-0 mb-[2px]"
							aria-label="Save"
							onClick={handleSubmit}
						>
							<Check className="h-3.5 w-3.5" />
						</Button>
					</TooltipPrimitive.Trigger>
					<TooltipContent side="bottom">
						<p className="flex items-center gap-1">
							Save <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
						</p>
					</TooltipContent>
				</TooltipPrimitive.Root>
			</TooltipPrimitive.Provider>
		</div>
	)
}
