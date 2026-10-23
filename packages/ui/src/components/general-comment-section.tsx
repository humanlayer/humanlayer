import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CommentEditor } from './comment-editor'
import { type UserInfo, CommentThread } from './comment-thread'
import { ResolvedCommentSection } from './resolved-comment-section'

interface GeneralCommentSectionProps {
	threads: Array<{ root: ArtifactComment; replies: ArtifactComment[] }>
	onReply: (parentCommentId: string, contentText: string, contentJson: string) => void
	onDelete: (commentId: string) => void
	onEdit?: (commentId: string, contentText: string, contentJson: string) => void
	onResolve?: (commentId: string) => void
	onUnresolve?: (commentId: string) => void
	onCreateComment: (contentText: string, contentJson: string) => void
	currentUserId: string
	userLookup?: Map<string, UserInfo>
	currentUserDisplayName?: string
}

export function GeneralCommentSection({
	threads,
	onReply,
	onDelete,
	onEdit,
	onResolve,
	onUnresolve,
	onCreateComment,
	currentUserId,
	userLookup,
	currentUserDisplayName,
}: GeneralCommentSectionProps) {
	const currentUser = userLookup?.get(currentUserId)
	const displayName = currentUserDisplayName ?? currentUser?.displayName

	// Local state for the new general-comment editor (not part of the draft scope this phase).
	const [newCommentValue, setNewCommentValue] = useState('')

	const editorRef = useRef<HTMLDivElement>(null)
	const lastThreadRef = useRef<HTMLDivElement>(null)
	const prevCommentCountRef = useRef(0)
	const prevThreadCountRef = useRef(0)

	const { activeThreads, resolvedThreads } = useMemo(() => {
		const active: typeof threads = []
		const resolved: typeof threads = []
		for (const thread of threads) {
			if (thread.root.is_resolved) {
				resolved.push(thread)
			} else {
				active.push(thread)
			}
		}
		return { activeThreads: active, resolvedThreads: resolved }
	}, [threads])

	// Total comments in active threads (roots + replies)
	const totalActiveComments = activeThreads.reduce((sum, t) => sum + 1 + t.replies.length, 0)

	// Auto-scroll and focus when comments change
	useEffect(() => {
		const isNewThread = activeThreads.length > prevThreadCountRef.current && prevThreadCountRef.current > 0
		const isNewComment = totalActiveComments > prevCommentCountRef.current && prevCommentCountRef.current > 0

		if (isNewThread) {
			// New thread created: scroll to it and focus its reply editor
			const threadEl = lastThreadRef.current
			if (threadEl) {
				threadEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
				// Focus the reply editor's contenteditable element within the new thread
				requestAnimationFrame(() => {
					const replyEditor = threadEl.querySelector<HTMLElement>('[contenteditable="true"]')
					replyEditor?.focus()
				})
			}
		} else if (isNewComment) {
			// Reply added to existing thread: scroll to bottom editor
			editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
		}

		prevCommentCountRef.current = totalActiveComments
		prevThreadCountRef.current = activeThreads.length
	}, [totalActiveComments, activeThreads.length])

	return (
		<div className="space-y-3">
			<div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">General Comments</div>
			{activeThreads.length > 0 && (
				<div className="space-y-3">
					{activeThreads.map(({ root, replies }, index) => (
						<div key={root.id} ref={index === activeThreads.length - 1 ? lastThreadRef : undefined}>
							<CommentThread
								rootComment={root}
								replies={replies}
								onReply={onReply}
								onDelete={onDelete}
								onEdit={onEdit}
								onResolve={onResolve}
								currentUserId={currentUserId}
								userLookup={userLookup}
							/>
						</div>
					))}
				</div>
			)}
			{resolvedThreads.length > 0 && (
				<div>
					<ResolvedCommentSection
						threads={resolvedThreads}
						onReply={onReply}
						onDelete={onDelete}
						onEdit={onEdit}
						onUnresolve={onUnresolve}
						currentUserId={currentUserId}
						userLookup={userLookup}
					/>
				</div>
			)}
			<div ref={editorRef} className="rounded-md border overflow-hidden">
				<CommentEditor
					value={newCommentValue}
					onChange={setNewCommentValue}
					onSubmit={(text, json) => {
						onCreateComment(text, json)
						setNewCommentValue('')
					}}
					placeholder="Leave a comment..."
					currentUserDisplayName={displayName}
				/>
			</div>
		</div>
	)
}
