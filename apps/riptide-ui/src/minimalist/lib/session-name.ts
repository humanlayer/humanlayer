/** An explicit session name wins over its generated summary, which can arrive after launch. */
export function sessionName(
	session: { title?: string | null; summary?: string | null },
	fallback = 'Untitled session',
): string {
	return session.title?.trim() || session.summary?.trim() || fallback
}
