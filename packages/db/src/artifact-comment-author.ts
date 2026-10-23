/** Who wrote an artifact comment: a signed-in user, or a guest on a public share link. */
export type ArtifactCommentAuthor =
	| { kind: 'user'; userId: string }
	| { kind: 'guest'; anonymousAuthorId: string; guestName: string }

interface CommentAuthorFields {
	created_by_user_id: string | null
	anonymous_author_id?: string | null
	anonymous_guest_name?: string | null
}

/** The four author columns for a row a signed-in user writes. */
export function userAuthoredCommentColumns(userId: string) {
	return {
		created_by_user_id: userId,
		anonymous_author_id: null,
		anonymous_guest_name: null,
		created_via_public_share: false,
	}
}

/** The four author columns for any author. Guests only write through public share links. */
export function commentAuthorColumns(author: ArtifactCommentAuthor) {
	if (author.kind === 'user') return userAuthoredCommentColumns(author.userId)
	return {
		created_by_user_id: null,
		anonymous_author_id: author.anonymousAuthorId,
		anonymous_guest_name: author.guestName,
		created_via_public_share: true,
	}
}

/** Reads the author back from a row. Null only for rows the database check would reject. */
export function commentAuthor(row: CommentAuthorFields): ArtifactCommentAuthor | null {
	if (row.created_by_user_id) return { kind: 'user', userId: row.created_by_user_id }
	if (row.anonymous_author_id && row.anonymous_guest_name)
		return { kind: 'guest', anonymousAuthorId: row.anonymous_author_id, guestName: row.anonymous_guest_name }
	return null
}

/** A stable key per author, for grouping participants. A row with no author keys on its own id. */
export function commentAuthorKey(row: CommentAuthorFields & { id: string }): string {
	return row.created_by_user_id ?? row.anonymous_author_id ?? row.id
}
