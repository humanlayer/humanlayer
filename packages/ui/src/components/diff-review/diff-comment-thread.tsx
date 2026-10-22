import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { useDraftField } from '../../hooks/use-draft-field'
import { ThreadDeliveryControl } from '../../artifact-viewer-v2/delivery/ThreadDeliveryControl'
import type { ArtifactDeliveryCapability } from '../../artifact-viewer-v2/delivery/types'
import type { ProjectedDiffThread } from '../../lib/diff-review/project-diff-comments'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'
import { cn } from '../../lib/utils'
import { Badge } from '../badge'
import { Button } from '../button'
import { KeyboardShortcut } from '../keyboard-shortcut'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../dropdown-menu'
import { DiffCommentLeaf } from './diff-comment-leaf'

export type DiffCommentDeliveryMode = 'send' | 'send-and-resolve'

export interface DiffCommentThreadProps {
	readonly thread: ProjectedDiffThread
	readonly className?: string
	readonly taskId?: string
	readonly currentUserId?: string
	readonly currentUserDisplayName?: string
	readonly currentUserAvatarUrl?: string
	readonly deliveryMode?: DiffCommentDeliveryMode
	readonly deliveryCapability?: ArtifactDeliveryCapability
	readonly onDeliveryModeChange?: (mode: DiffCommentDeliveryMode) => void
	readonly onReply?: (input: { taskId: string; rootCommentId: string; contentText: string; contentJson: string }) => Promise<boolean>
	readonly onEdit?: (input: { commentId: string; contentText: string; contentJson: string }) => Promise<boolean>
	readonly onDelete?: (input: { commentId: string }) => Promise<void> | void
	readonly onCopyLink?: (input: { rootCommentId: string }) => void
	readonly onResolve?: (input: { commentId: string; isResolved: boolean }) => Promise<void> | void
	readonly onDeliver?: (input: { rootCommentId: string; mode: DiffCommentDeliveryMode }) => Promise<void> | void
	readonly replyRequest?: { readonly rootId: string; readonly requestId: number }
	/** Hide the C hotkey hint where the diff's keyboard navigation does not reach (e.g. the comments panel). */
	readonly showReplyShortcut?: boolean
}

export type DiffCommentThreadInteractionProps = Omit<DiffCommentThreadProps, 'thread' | 'className'>

function getDiffCommentThreadTargetId(rootId: string): string {
	return `diff-comment-${rootId}`
}

export function DiffCommentThread({
	thread,
	className,
	taskId,
	currentUserId,
	deliveryMode = 'send-and-resolve',
	deliveryCapability = { kind: 'send', sessionId: 'diff-comment-thread' },
	onDeliveryModeChange,
	onReply,
	onEdit,
	onDelete,
	onCopyLink,
	onResolve,
	onDeliver,
	replyRequest,
	showReplyShortcut = true,
}: DiffCommentThreadProps) {
	const { root, replies, placement } = thread
	const outdated = placement.status === 'outdated-inline' || placement.status === 'outdated-file' || placement.status === 'file-missing'
	const [resolvedExpanded, setResolvedExpanded] = useState(false)
	const [replying, setReplying] = useState(false)
	const [replyPending, setReplyPending] = useState(false)
	const replyEditorRef = useRef<HTMLTextAreaElement>(null)
	const replyDraft = useDraftField(draftSessionStorageKeys.diffCommentReply(root.id))
	const interactive = Boolean(taskId && onReply)

	useEffect(() => {
		if (replyRequest?.rootId !== root.id || !interactive) return
		setResolvedExpanded(true)
		setReplying(true)
	}, [interactive, replyRequest?.requestId, replyRequest?.rootId, root.id])

	useEffect(() => {
		if (!replying || replyRequest?.rootId !== root.id) return
		replyEditorRef.current?.focus()
	}, [replyRequest?.requestId, replyRequest?.rootId, replying, root.id])

	const submitReply = async () => {
		const contentText = replyDraft.value.trim()
		if (!taskId || !onReply || !contentText || replyPending) return
		setReplyPending(true)
		const accepted = await onReply({
			taskId,
			rootCommentId: root.id,
			contentText,
			contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: contentText }] }] }),
		})
		setReplyPending(false)
		if (!accepted) return
		replyDraft.clear()
		setReplying(false)
	}

	const comments = (
		<>
			<DiffCommentLeaf comment={root} rootCommentId={root.id} outdated={outdated} currentUserId={currentUserId} onCopyLink={onCopyLink} onEdit={onEdit} onDelete={onDelete} />
			{replies.map((reply) => (
				<div key={reply.id} className="pl-4">
					<DiffCommentLeaf comment={reply} rootCommentId={root.id} currentUserId={currentUserId} onCopyLink={onCopyLink} onEdit={onEdit} onDelete={onDelete} />
				</div>
			))}
		</>
	)

	const replyEditor = replying ? (
		<div className="px-4 py-3">
			<textarea
				ref={replyEditorRef}
				autoFocus
				value={replyDraft.value}
				onChange={(event) => replyDraft.setValue(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.preventDefault()
						event.stopPropagation()
						setReplying(false)
					} else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
						event.preventDefault()
						void submitReply()
					}
				}}
				placeholder="Add a reply"
				aria-label="Reply to diff comment"
				className="min-h-20 w-full resize-y border border-input bg-background px-2 py-1.5 text-sm outline-none focus:border-ring"
			/>
			<div className="mt-2 flex flex-wrap items-center justify-end gap-2">
				{replyDraft.value.trim() ? <span className="mr-auto text-xs italic text-muted-foreground">draft saved</span> : <span className="mr-auto" />}
				<Button type="button" variant="secondary" size="sm" onClick={() => {
					replyDraft.clear()
					setReplying(false)
				}}>
					Discard <KeyboardShortcut size="xs">Escape</KeyboardShortcut>
				</Button>
				<Button type="button" size="sm" disabled={replyPending || !replyDraft.value.trim()} onClick={() => void submitReply()}>
					{replyPending ? 'Replying...' : 'Reply'} <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
				</Button>
			</div>
		</div>
	) : null

	const canDeliver = !root.is_deleted && !root.is_resolved && Boolean(onDeliver)
	const actions = interactive || (!root.is_resolved && onResolve) || canDeliver ? (
		// Wraps whole controls onto a second line in narrow cards (split view, side panel).
		<div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 text-xs">
			{interactive ? (
				<Button
					type="button"
					variant="secondary"
					size="xs"
					aria-keyshortcuts={showReplyShortcut ? 'c' : undefined}
					onClick={() => setReplying(true)}
				>
					Reply{' '}
					{showReplyShortcut ? (
						<span aria-hidden="true">
							<KeyboardShortcut size="xs">C</KeyboardShortcut>
						</span>
					) : null}
				</Button>
			) : null}
			{!root.is_resolved && onResolve ? <button type="button" className="whitespace-nowrap text-muted-foreground hover:text-foreground" onClick={() => void onResolve({ commentId: root.id, isResolved: true })}>Resolve</button> : null}
			{canDeliver && onDeliver ? (
				deliveryCapability.kind === 'copy' ? (
					<ThreadDeliveryControl
						capability={deliveryCapability}
						mode={deliveryMode}
						onCopy={() => void onDeliver({ rootCommentId: root.id, mode: deliveryMode })}
						className="ml-auto"
						compact
					/>
				) : (
					<ThreadDeliveryControl
						capability={deliveryCapability}
						mode={deliveryMode}
						onModeChange={onDeliveryModeChange}
						onDeliver={(mode) => void onDeliver({ rootCommentId: root.id, mode })}
						className="ml-auto"
						compact
					/>
				)
			) : null}
		</div>
	) : null

	if (root.is_resolved) {
		return (
			<article
				id={getDiffCommentThreadTargetId(root.id)}
				data-diff-comment-root-id={root.id}
				tabIndex={-1}
				className={cn('@container mx-4 my-3 divide-y divide-border overflow-hidden rounded-md border border-border bg-card text-xs text-muted-foreground', className)}
			>
				<div className="flex min-w-0 items-center gap-2 px-4 py-2.5">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="size-6 shrink-0"
						aria-label={resolvedExpanded ? 'Collapse resolved thread' : 'Expand resolved thread'}
						aria-expanded={resolvedExpanded}
						onClick={() => setResolvedExpanded((expanded) => !expanded)}
					>
						{resolvedExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
					</Button>
					{/* The count and badge wrap below the title in a narrow card rather than hiding it. */}
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
						<span className="min-w-[5ch] max-w-full truncate font-medium text-foreground">Resolved thread</span>
						<span className="flex items-center gap-2">
							<span className="whitespace-nowrap">{replies.length + 1} comments</span>
							{outdated ? (
								<Badge variant="outline" className="shrink-0 border-[var(--terminal-warning)]/50 text-[10px] uppercase text-[var(--terminal-warning)]">
									Outdated
								</Badge>
							) : null}
						</span>
					</div>
					{onResolve || onCopyLink ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button type="button" variant="ghost" size="icon" className="ml-auto size-6 shrink-0" aria-label="Open resolved comment actions">
									<MoreHorizontal className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{onResolve ? (
									<DropdownMenuItem onClick={() => void onResolve({ commentId: root.id, isResolved: false })}>
										Reopen thread
									</DropdownMenuItem>
								) : null}
								{onCopyLink ? (
									<DropdownMenuItem onClick={() => onCopyLink({ rootCommentId: root.id })}>Copy link</DropdownMenuItem>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
				{resolvedExpanded ? <>{comments}{actions}{replyEditor}</> : null}
			</article>
		)
	}

	return (
		<article
			id={getDiffCommentThreadTargetId(root.id)}
			data-diff-comment-root-id={root.id}
			tabIndex={-1}
			className={cn('@container mx-4 my-4 divide-y divide-border overflow-hidden rounded-md border border-border bg-card focus-visible:rounded-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', className)}
		>
			{comments}
			{actions}
			{replyEditor}
		</article>
	)
}
