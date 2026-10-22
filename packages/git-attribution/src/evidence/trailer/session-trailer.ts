import { isSessionId } from '../../shared/session-id'

/**
 * The `HumanLayer-Session` trailer vocabulary — tokens, the session deep-link, and the read-side
 * parsers — as a LEAF module (zod-only, itself isomorphic).
 *
 * The WRITE side (the env-carried session URL the ./hook-scripts stampers append) and the READ side (the daemon's HEAD-watch
 * attribution, and eventually the server-side trailer backfill) share these definitions so they
 * can never drift: a token the writer stamps that the reader doesn't recognize would silently
 * downgrade attribution to 'human'.
 */

/** The trailer token the writers stamp and capture reads. */
export const SESSION_TRAILER_TOKEN = 'HumanLayer-Session'

// Matches one trailer LINE and captures its value. Shared by the read-side parsers so they
// can't drift from each other.
const SESSION_TRAILER_LINE_RE = new RegExp(`^${SESSION_TRAILER_TOKEN}:\\s*(.+)$`, 'i')

/**
 * The session id ONE trailer line names, or undefined for anything else — the single
 * interpretation of a trailer value, shared by every reader below. Inverse of
 * {@link sessionCommitUrl}: the value is the `<appOrigin>/sessions/<sessionId>` deep-link, so
 * the id is its last path segment (query/hash and trailing slashes stripped first). The trailer
 * is world-writable input (it rides any commit message, including ones from public/forked
 * repos), so only a segment {@link isSessionId} accepts counts — see ./session-id for why
 * letting a malformed/truncated/hostile one through wedges capture.
 */
function sessionIdFromTrailerLine(line: string): string | undefined {
	const m = line.match(SESSION_TRAILER_LINE_RE)
	if (!m?.[1]) return undefined
	const url = m[1]
		.trim()
		.replace(/[?#].*$/, '')
		.replace(/\/+$/, '')
	const id = url.slice(url.lastIndexOf('/') + 1)
	return isSessionId(id) ? id : undefined
}

/**
 * True when a commit body carries a `HumanLayer-Session` trailer naming exactly this session.
 * Used by post-run capture to keep only the agent's own commits. Matches only the trailer line
 * (not a stray id elsewhere in the message) so it can't false-positive on prose.
 */
export function commitReportsSession(body: string | undefined, sessionId: string): boolean {
	if (!body) return false
	return body.split('\n').some((line) => sessionIdFromTrailerLine(line) === sessionId)
}

/**
 * Extract the session id a commit body's `HumanLayer-Session` trailer names — the first line
 * that {@link sessionIdFromTrailerLine} accepts — or undefined when there is no such trailer.
 */
export function parseSessionFromTrailer(body: string | undefined): string | undefined {
	if (!body) return undefined
	for (const line of body.split('\n')) {
		const id = sessionIdFromTrailerLine(line)
		if (id !== undefined) return id
	}
	return undefined
}

// The session deep-link builder lives in the pure leaf (../../git-env) so the webview PTY
// launcher mints the identical URL; re-exported here as part of the trailer vocabulary.
export { sessionCommitUrl } from '../../git-env'
