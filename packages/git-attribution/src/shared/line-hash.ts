import { createHash } from 'node:crypto'

/**
 * Content-addressing primitives for attribution — normalize a line, SHA-1 it, build comparable
 * hash sets. LEAF module (node builtins only): both the producers (./agent-edit via every
 * harness's tool stream) and the consumer (./attribution's inferred-tier matcher) hash through
 * here, so a commit's added lines and a session's authored lines can never disagree on
 * normalization.
 */

/**
 * Canonicalize one line for content matching: trim, collapse internal whitespace runs to a single
 * space. Returns null for empty/whitespace-only lines so trivial lines never inflate an overlap.
 */
export function normalizeLine(line: string): string | null {
	const collapsed = line.trim().replace(/\s+/g, ' ')
	return collapsed.length > 0 ? collapsed : null
}

/** SHA-1 hex of a normalized line. Content-address so overlap is a cheap Set intersection. */
export function hashLine(normalized: string): string {
	return createHash('sha1').update(normalized).digest('hex')
}

/** A 40-char lowercase hex sha1 — the on-disk journal's line format (see ./authorship-journal). */
export const LINE_HASH_RE = /^[0-9a-f]{40}$/

/**
 * Split each text on newlines, {@link normalizeLine} every line, and collect the SHA-1 of each
 * non-null line into a Set (deduping identical lines). Used for both a commit's added lines and a
 * session's accumulated authored lines so the two can be intersected.
 */
export function buildLineHashSet(texts: readonly string[]): Set<string> {
	const set = new Set<string>()
	for (const text of texts) {
		for (const rawLine of text.split('\n')) {
			const normalized = normalizeLine(rawLine)
			if (normalized !== null) set.add(hashLine(normalized))
		}
	}
	return set
}

/** Count normalized non-null lines across texts (with duplicates), matching {@link buildLineHashSet}'s split/normalize. */
export function countNormalizedLines(texts: readonly string[]): number {
	let count = 0
	for (const text of texts) {
		for (const rawLine of text.split('\n')) {
			if (normalizeLine(rawLine) !== null) count++
		}
	}
	return count
}
