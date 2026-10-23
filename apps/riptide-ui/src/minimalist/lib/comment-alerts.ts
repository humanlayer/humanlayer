/** Comments that land just before the app finished loading still count as new. */
const GRACE_MS = 5_000
const SNIPPET = 100

type AlertComment = {
	created_by_user_id: string | null
	created_by_agent: boolean
	created_at: bigint | number
}

/**
 * A comment a teammate or an agent wrote since the app opened, rather than one
 * you wrote or an old one syncing in. Whether it's on your work is the caller's
 * check: that needs a lookup.
 */
export function isNewComment(comment: AlertComment, state: { me: string; openedAt: number; now: number }): boolean {
	if (comment.created_by_user_id === state.me && !comment.created_by_agent) return false
	const at = Number(comment.created_at)
	return at >= state.openedAt || state.now - at <= GRACE_MS
}

/** "Ada commented on plan.md", "The agent replied on app.ts". */
export function alertTitle(
	comment: AlertComment & { reply_to_comment_id: string | null },
	state: { me: string; name: string; file: string },
): string {
	const own = comment.created_by_user_id === state.me
	const who = comment.created_by_agent ? (own ? 'The agent' : `${state.name}'s agent`) : state.name
	return `${who} ${comment.reply_to_comment_id ? 'replied on' : 'commented on'} ${state.file}`
}

export function alertSnippet(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim()
	return flat.length > SNIPPET ? `${flat.slice(0, SNIPPET - 1)}…` : flat
}
