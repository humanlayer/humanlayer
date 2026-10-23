export interface DiffCommentThreadRow {
	readonly id: string
	readonly reply_to_comment_id: string | null
}
export const buildDiffCommentIndex = <Row extends DiffCommentThreadRow>(rows: readonly Row[]) =>
	new Map(rows.map((row) => [row.id, row]))
export function getDiffCommentRoot<Row extends DiffCommentThreadRow>(
	comment: Row,
	rowsById: ReadonlyMap<string, Row>,
): Row | undefined {
	if (comment.reply_to_comment_id === null) return comment
	const root = rowsById.get(comment.reply_to_comment_id)
	return root?.reply_to_comment_id === null ? root : undefined
}
export const isDirectDiffCommentReply = <Row extends DiffCommentThreadRow>(reply: Row, root: Row) =>
	root.reply_to_comment_id === null && reply.reply_to_comment_id === root.id

/**
 * Resolves the short comment ID exposed to models and daemon tools back to its
 * full random UUID while preserving not-found and ambiguous suffix outcomes.
 */
export function findDiffCommentByUniqueSuffix<Row extends { readonly id: string }>(
	rows: readonly Row[],
	suffix: string,
): { readonly kind: 'not_found' } | { readonly kind: 'ambiguous' } | { readonly kind: 'found'; readonly comment: Row } {
	const matches = rows.filter((row) => row.id.toLowerCase().endsWith(suffix.toLowerCase()))
	if (matches.length === 0) return { kind: 'not_found' }
	if (matches.length > 1) return { kind: 'ambiguous' }
	const comment = matches[0]
	return comment ? { kind: 'found', comment } : { kind: 'not_found' }
}
