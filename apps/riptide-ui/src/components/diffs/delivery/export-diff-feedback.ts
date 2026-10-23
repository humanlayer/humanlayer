import type { ExportedDiffComments } from '@humanlayer/ui/lib/diff-review/export-diff-comments'

export interface ExportedDiffFeedback {
	readonly text: string
	readonly rootCommentIds: readonly string[]
}

export function exportDiffFeedback(editorText: string, comments: ExportedDiffComments): ExportedDiffFeedback {
	const trimmedEditorText = editorText.trim()
	return {
		text: trimmedEditorText ? `${trimmedEditorText}\n\n${comments.xml}` : comments.xml,
		rootCommentIds: comments.rootCommentIds,
	}
}
