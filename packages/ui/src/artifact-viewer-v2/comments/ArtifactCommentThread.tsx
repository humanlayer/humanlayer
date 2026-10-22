import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { CircleCheck, FileSymlink } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'

import { Avatar, AvatarFallback, AvatarImage } from '../../components/avatar'
import { Button } from '../../components/button'
import { formatRelativeTime } from '../../lib/comment-utils'
import { cn } from '../../lib/utils'
import type { CommentKind } from '../anchor/types'
import { ArtifactCommentEditForm } from '../compose/ArtifactCommentEditForm'
import { MarkdownRenderer } from '../../components/markdown-renderer'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/tooltip'
import { ArtifactCommentActionsMenu } from './ArtifactCommentActionsMenu'
import { CommentOriginalText } from './CommentOriginalText'

export interface ArtifactCommentEditInput {
	commentId: string
	contentText: string
	contentJson: ArtifactComment['content_json']
}

export interface ArtifactCommentThreadProps {
	authorName: string
	/** Null when the author has no avatar; the fallback renders initials. */
	authorAvatarUrl: string | null
	authorBadge?: ReactNode
	createdAt: bigint
	/** Comment body (markdown source, rendered as pre-wrapped text for now). */
	contentText: string
	/**
	 * Typed verdict. `deletion`/`approval` render a labelled chip; `comment` is
	 * visually neutral so free-form feedback never reads as a typed verdict.
	 */
	kind: CommentKind
	/** Transient selected/hovered emphasis, mirrored with the document highlight. */
	active: boolean
	/** The stored quote no longer resolves in the current document. */
	outdated: boolean
	/**
	 * Saved selection text, shown as plain "Original text" on Outdated cards.
	 * Null or empty when the anchor carries no text.
	 */
	originalText?: string | null
	/** Reveals the thread's anchored document location. Omitted when unavailable. */
	onJumpTo?: () => void
	/** `onJumpTo` targets an approximate location recovered from neighboring text. */
	jumpApproximate?: boolean
	/**
	 * Thread is resolved — rendered dimmed in the rail's Resolved section. A
	 * resolved thread has no document highlight; the caller supplies `onReopen`
	 * instead of `onResolve`.
	 */
	resolved?: boolean
	onActivate: () => void
	onHoverChange: (hovering: boolean) => void
	/**
	 * When provided, renders a "Reply" affordance that opens the thread's reply
	 * composer. The caller omits it while the composer is already open. Kept
	 * outside the clickable root region so it is not nested inside a button.
	 */
	onReply?: () => void
	/**
	 * When provided, renders a "Resolve" action that resolves the whole thread
	 * (server cascade). The consuming rail owns the mutation; this leaf only
	 * forwards the callback. Omitted for already-resolved threads.
	 */
	onResolve?: () => void
	/**
	 * When provided, renders a "Reopen" action that unresolves the whole thread.
	 * Supplied instead of `onResolve` for threads in the Resolved section.
	 */
	onReopen?: () => void
	commentId?: string
	contentJson?: ArtifactComment['content_json']
	onEditComment?: (input: ArtifactCommentEditInput) => unknown
	onDelete?: (returnFocusElement: HTMLButtonElement | null) => void
	/**
	 * When provided, renders a "Copy link" action for this root. The caller owns
	 * URL construction and clipboard access; this leaf only forwards the click,
	 * so no router or clipboard dependency enters `packages/ui`.
	 */
	onCopyLink?: () => void
	/**
	 * Per-thread delivery control slot, composed by the consuming rail for OPEN
	 * root threads only and rendered inside the thread actions row. Dispatch,
	 * capability, and permission logic stay with the caller; resolved threads
	 * omit the slot entirely so they never show send controls.
	 */
	deliveryControl?: ReactNode
	/**
	 * Composed reply rows and (when open) the reply composer, supplied by the
	 * consuming rail. Rendered beneath the root card, outside the root's
	 * activation button so nested interactive controls stay valid.
	 */
	children?: ReactNode
}

const KIND_CHIP: Record<Exclude<CommentKind, 'comment'>, { label: string; className: string }> = {
	deletion: { label: 'Delete', className: 'artifact-viewer-v2-comment-thread-kind-deletion' },
	approval: { label: 'Approve', className: 'artifact-viewer-v2-comment-thread-kind-approval' },
}

function getInitials(name: string): string {
	return name
		.split(' ')
		.map((word) => word[0])
		.join('')
		.toUpperCase()
		.slice(0, 2)
}

/**
 * Minimal persisted root-comment display for the review rail: author
 * identity, timestamp, body, and transient active styling. Replies and
 * mutation menus arrive in later slices; humans author all V2 roots, so
 * there is no agent identity here.
 */
export function ArtifactCommentThread({
	authorName,
	authorAvatarUrl,
	authorBadge,
	createdAt,
	contentText,
	kind,
	active,
	outdated,
	originalText,
	onJumpTo,
	jumpApproximate = false,
	resolved,
	onActivate,
	onHoverChange,
	onReply,
	onResolve,
	onReopen,
	commentId,
	contentJson = null,
	onEditComment,
	onDelete,
	onCopyLink,
	deliveryControl,
	children,
}: ArtifactCommentThreadProps) {
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
	const chip = kind === 'comment' ? null : KIND_CHIP[kind]
	const hasActionsMenu = Boolean((onEditComment || onDelete) && commentId && !editing)
	const hasHeaderActions = Boolean(onJumpTo || onResolve || onReopen || hasActionsMenu)
	const jumpLabel = jumpApproximate ? 'Jump to the approximate location' : 'Jump to the comment in the artifact'
	return (
		<article
			className={cn(
				'artifact-viewer-v2-comment-thread',
				active && 'artifact-viewer-v2-comment-thread-active',
				resolved && 'artifact-viewer-v2-comment-thread-resolved',
				hasHeaderActions && 'artifact-viewer-v2-comment-thread-has-actions',
			)}
			onMouseEnter={() => onHoverChange(true)}
			onMouseLeave={() => onHoverChange(false)}
		>
			{hasHeaderActions ? (
				<div className="artifact-viewer-v2-comment-actions-slot">
					{onJumpTo ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="size-6 shrink-0"
									onClick={(event) => {
										event.stopPropagation()
										onJumpTo()
									}}
									onPointerDown={(event) => event.stopPropagation()}
									aria-label={jumpLabel}
								>
									<FileSymlink className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent portalled={false}>{jumpLabel}</TooltipContent>
						</Tooltip>
					) : null}
					{onResolve || onReopen ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className={cn(
										'size-6 shrink-0 text-[var(--terminal-success)] hover:border-[var(--terminal-success)]/50 hover:bg-[var(--terminal-success)]/10 hover:text-[var(--terminal-success)]',
										resolved && 'bg-[var(--terminal-success)]/15',
									)}
									onClick={(event) => {
										event.stopPropagation()
										if (onResolve) onResolve()
										else onReopen?.()
									}}
									onPointerDown={(event) => event.stopPropagation()}
									aria-label={onResolve ? 'Resolve thread' : 'Reopen thread'}
								>
									<CircleCheck className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent portalled={false}>{onResolve ? 'Resolve thread' : 'Reopen thread'}</TooltipContent>
						</Tooltip>
					) : null}
					{hasActionsMenu ? (
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
					) : null}
				</div>
			) : null}
			<div
				role="button"
				tabIndex={0}
				aria-pressed={active}
				className="artifact-viewer-v2-comment-thread-root"
				onClick={onActivate}
				onKeyDown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						onActivate()
					}
				}}
			>
				<header className="artifact-viewer-v2-comment-thread-header">
					<Avatar className="size-5">
						<AvatarImage src={authorAvatarUrl ?? undefined} alt={authorName} />
						<AvatarFallback className="text-[9px]">{getInitials(authorName)}</AvatarFallback>
					</Avatar>
					<span className="artifact-viewer-v2-comment-thread-author">{authorName}</span>
					{authorBadge}
					{chip && (
						<span
							className={cn('artifact-viewer-v2-comment-thread-kind', chip.className)}
							aria-label={`${chip.label} verdict`}
						>
							{chip.label}
						</span>
					)}
					<span className="artifact-viewer-v2-comment-thread-time">{formatRelativeTime(createdAt)}</span>
					{outdated && <span className="artifact-viewer-v2-comment-thread-outdated">Outdated</span>}
				</header>
				{!editing ? <div className="artifact-viewer-v2-comment-thread-body"><MarkdownRenderer content={contentText} variant="pretty" preserveSingleLineBreaks /></div> : null}
			</div>
			{outdated && originalText ? <CommentOriginalText text={originalText} /> : null}
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
			{children}
			{(onReply || onCopyLink || deliveryControl) && (
				<div className="artifact-viewer-v2-comment-thread-actions">
					{onReply && (
						<button type="button" className="artifact-viewer-v2-comment-thread-action" onClick={onReply}>
							Reply
						</button>
					)}
					{onCopyLink && (
						<button
							type="button"
							className="artifact-viewer-v2-comment-thread-action"
							onClick={onCopyLink}
						>
							Copy link
						</button>
					)}
					{deliveryControl && (
						<div className="artifact-viewer-v2-comment-thread-delivery">{deliveryControl}</div>
					)}
				</div>
			)}
		</article>
	)
}
