import { CommentEditor } from '../../components/comment-editor'
import { useDraftField } from '../../hooks/use-draft-field'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'

export interface ReplyComposerProps {
	/** The root comment this reply belongs to; scopes the persisted draft. */
	rootCommentId: string
	/**
	 * Persist the reply body. Resolves `true` once the reply is confirmed so the
	 * per-thread draft can be cleared; `false` keeps the draft for retry.
	 */
	onSubmit: (contentText: string) => Promise<boolean>
	/** Soft close (Escape / outside interaction). The per-thread draft is kept. */
	onDismiss: () => void
	currentUserDisplayName?: string
	currentUserAvatarUrl?: string
}

/**
 * Root-comment-scoped reply composer: the reusable `CommentEditor` core wrapped
 * with the `comment:reply:{rootCommentId}` sessionStorage draft convention.
 * Rendered inline beneath a thread card in the review rail; it never imports
 * collections, routes, or auth — the consuming app owns persistence.
 */
export function ReplyComposer({
	rootCommentId,
	onSubmit,
	onDismiss,
	currentUserDisplayName,
	currentUserAvatarUrl,
}: ReplyComposerProps) {
	const draft = useDraftField(draftSessionStorageKeys.reply(rootCommentId))

	const handleSubmit = async (contentText: string) => {
		const persisted = await onSubmit(contentText)
		if (persisted) draft.clear()
	}

	return (
		<div className="artifact-viewer-v2-reply-composer" onMouseDown={(e) => e.stopPropagation()}>
			<CommentEditor
				value={draft.value}
				onChange={draft.setValue}
				onSubmit={handleSubmit}
				placeholder="Reply..."
				autoFocus
				// Escape soft-closes and keeps the draft.
				onCancel={onDismiss}
				onDiscard={() => {
					draft.clear()
					onDismiss()
				}}
				showDiscard
				currentUserDisplayName={currentUserDisplayName}
				currentUserAvatarUrl={currentUserAvatarUrl}
				variant="inline-reply"
			/>
		</div>
	)
}
