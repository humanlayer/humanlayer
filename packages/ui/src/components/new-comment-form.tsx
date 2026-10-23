import { useRef } from 'react'
import { useDraftField } from '../hooks/use-draft-field'
import { useMountEffect } from '../hooks/use-mount-effect'
import { draftSessionStorageKeys } from '../lib/draft-session-storage-keys'
import { CommentEditor } from './comment-editor'

export interface PendingCommentAnchor {
	commentedUponBlockText: string
	previousBlockText: string | null
	nextBlockText: string | null
}

interface NewCommentFormProps {
	/** Artifact this new comment belongs to — scopes the persisted draft. */
	artifactId: string
	/** Return false when the comment was not accepted so the draft stays open. */
	onSubmit: (contentText: string, contentJson?: string, anchor?: PendingCommentAnchor) => boolean | void
	pendingCommentAnchor?: PendingCommentAnchor
	onCancelHighlight?: () => void
	currentUserDisplayName?: string
}

export function NewCommentForm({
	artifactId,
	onSubmit,
	pendingCommentAnchor,
	onCancelHighlight,
	currentUserDisplayName,
}: NewCommentFormProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	// Per-artifact sessionStorage draft. The reactive hook is keyed by artifactId, so a
	// reused form instance (the viewers aren't keyed by artifactId) automatically tracks the
	// current artifact's draft instead of sticking to the one it mounted with.
	const draft = useDraftField(draftSessionStorageKeys.newComment(artifactId))

	useMountEffect(() => {
		const el = containerRef.current
		if (!el) return
		const handler = (e: WheelEvent) => {
			e.preventDefault()
			e.stopPropagation()
			const textarea = el.querySelector('textarea')
			if (textarea) {
				textarea.scrollTop += e.deltaY
			}
		}
		el.addEventListener('wheel', handler, { passive: false })
		return () => el.removeEventListener('wheel', handler)
	})

	const handleSubmit = (contentText: string, contentJson: string) => {
		const accepted = onSubmit(contentText, contentJson, pendingCommentAnchor)
		if (accepted === false) return
		draft.clear()
		onCancelHighlight?.()
	}

	return (
		<div
			ref={containerRef}
			className="rounded-md border overflow-hidden bg-card"
			onKeyDown={(e) => {
				if (e.key === 'Escape' && pendingCommentAnchor) {
					e.stopPropagation()
					e.preventDefault()
					// Soft close — keep the draft.
					onCancelHighlight?.()
				}
			}}
		>
			<CommentEditor
				value={draft.value}
				onChange={draft.setValue}
				onSubmit={handleSubmit}
				placeholder={pendingCommentAnchor ? 'Add comment...' : 'Leave a comment...'}
				autoFocus={!!pendingCommentAnchor}
				onCancel={onCancelHighlight}
				onDiscard={() => {
					draft.clear()
					onCancelHighlight?.()
				}}
				showDiscard={!!onCancelHighlight}
				currentUserDisplayName={currentUserDisplayName}
			/>
		</div>
	)
}
