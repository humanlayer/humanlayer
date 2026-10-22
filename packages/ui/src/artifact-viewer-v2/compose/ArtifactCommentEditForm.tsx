import type { ArtifactComment } from '@humanlayer/db/tables/artifact-comments'
import { useCallback, useState } from 'react'

import { CommentEditor } from '../../components/comment-editor'
import { useDraftField } from '../../hooks/use-draft-field'
import { draftSessionStorageKeys } from '../../lib/draft-session-storage-keys'

export interface ArtifactCommentEditFormProps {
	commentId: string
	initialText: string
	contentJson: ArtifactComment['content_json']
	editing: boolean
	pending: boolean
	error: string | null
	onStartEditing: () => void
	onCancel: () => void
	onSubmit: (input: {
		commentId: string
		contentText: string
		contentJson: ArtifactComment['content_json']
	}) => Promise<boolean>
}

export interface ArtifactCommentEditDraftMarkProps {
	onEdit: () => void
}

export function ArtifactCommentEditDraftMark({ onEdit }: ArtifactCommentEditDraftMarkProps) {
	return (
		<button type="button" className="artifact-viewer-v2-comment-edit-draft" onClick={onEdit}>
			edit in progress
		</button>
	)
}

export function ArtifactCommentEditForm({
	commentId,
	initialText,
	contentJson,
	editing,
	pending,
	error,
	onStartEditing,
	onCancel,
	onSubmit,
}: ArtifactCommentEditFormProps) {
	const draft = useDraftField(draftSessionStorageKeys.edit(commentId))
	const [value, setValue] = useState(draft.value || initialText)

	const handleChange = useCallback(
		(next: string) => {
			setValue(next)
			draft.setValue(next)
		},
		[draft],
	)

	const handleCancel = useCallback(() => {
		if (pending) return
		draft.clear()
		setValue(initialText)
		onCancel()
	}, [draft, initialText, onCancel, pending])

	const handleSubmit = useCallback(
		async (contentText: string) => {
			const saved = await onSubmit({ commentId, contentText, contentJson })
			if (saved) {
				draft.clear()
				setValue(contentText)
				onCancel()
			}
		},
		[commentId, contentJson, draft, onCancel, onSubmit],
	)

	if (!editing) {
		if (draft.value.trim() === '') return null
		return <ArtifactCommentEditDraftMark onEdit={onStartEditing} />
	}

	return (
		<div className="contents" data-artifact-comment-editing="true">
			<CommentEditor
				value={value}
				onChange={handleChange}
				onSubmit={(contentText) => void handleSubmit(contentText)}
				onCancel={handleCancel}
				autoFocus
				variant="inline-edit"
				disabled={pending}
				error={error}
			/>
		</div>
	)
}
