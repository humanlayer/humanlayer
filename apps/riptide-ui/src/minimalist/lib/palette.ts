/** Before you type, only what's useful here plus the basics; the rest appear as you search. */
const IDLE = new Set([
	'new-session',
	'archive-task',
	'copy-link',
	'fork',
	'new',
	'prs',
	'settings',
	'toggle-minimalist',
])

/** Context this full is worth offering to compact before you ask. */
const COMPACT_HINT_PERCENT = 60

/**
 * The actions to list: matches for a search, or the idle set before you type. Compact joins the
 * idle set once the context passes the hint mark.
 */
export function matchActions<T extends { id: string; label: string }>(
	items: readonly T[],
	query: string,
	contextPercent: number | null,
): T[] {
	const needle = query.trim().toLowerCase()
	if (needle) return items.filter((item) => item.label.toLowerCase().includes(needle))
	const compactHint = contextPercent !== null && contextPercent >= COMPACT_HINT_PERCENT
	return items.filter((item) => IDLE.has(item.id) || (compactHint && item.id === 'compact'))
}
