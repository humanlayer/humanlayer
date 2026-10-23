/**
 * Functional core of GitHub-response classification: pure verdict functions
 * with NO side effects. The {@link ./github-access.service} imperative shell
 * applies the verdicts (tripping its per-backend auth latch on
 * `unauthenticated`), so these stay directly unit-testable without any runtime.
 */

/**
 * Explicit-auth-failure guard: gh can silently fall back to unauthenticated API
 * requests when the token is missing/expired (cli/cli#13317), which surface as a
 * hard 401 — either on stderr with a non-zero exit, or embedded in a `message`
 * field of an otherwise-parseable JSON body. ONLY these hard-auth markers latch
 * the process.
 *
 * "To get started with GitHub CLI" is gh's LOCAL no-credentials-at-all failure
 * ("please run: gh auth login") — it never reaches GitHub, but it is just as
 * hard/non-transient as a 401, so it latches too; the periodic refresh tick's
 * latch reset gives it a fresh probe after the operator logs in.
 *
 * "API rate limit exceeded" is deliberately NOT here: an AUTHENTICATED caller can
 * hit the 5000/hr limit too, so latching on it would disable PR tracking for the
 * whole daemon lifetime over a transient throttle. Rate limits fall through to a
 * transient `error` (skip this call, no latch) instead.
 */
const AUTH_FAILURE_REGEX = /HTTP 401|Requires authentication|To get started with GitHub CLI/i

/**
 * Rate-limit markers. Deliberately separate from {@link AUTH_FAILURE_REGEX}: an
 * authenticated caller can be throttled too, so these are classified as a
 * transient `error` (skip this call) and NEVER latch the process.
 */
const RATE_LIMIT_REGEX = /API rate limit exceeded|secondary rate limit/i

/** True when a string carries a hard GitHub auth-failure marker (HTTP 401 / Requires authentication). */
export function isGhAuthFailureMessage(text: string): boolean {
	return AUTH_FAILURE_REGEX.test(text)
}

/** True when a string carries a GitHub rate-limit marker (transient; never latches). */
export function isGhRateLimitMessage(text: string): boolean {
	return RATE_LIMIT_REGEX.test(text)
}

/**
 * Pure classification verdict. `unauthenticated` is the ONLY verdict that makes
 * the service trip its auth latch; `error` is always a transient skip.
 */
export type GithubVerdict<T> = { kind: 'ok'; data: T } | { kind: 'unauthenticated' } | { kind: 'error' }

/** Raw outcome of attempting to run gh: stdout on exit 0, or the caught error. */
export type GhExecOutcome = { stdout: string } | { execError: unknown }

/** Scan an exec error's stderr/stdout/message for a silent-auth marker. */
function authFailureInError(error: unknown): boolean {
	if (error && typeof error === 'object') {
		const e = error as { stderr?: unknown; stdout?: unknown; message?: unknown }
		for (const stream of [e.stderr, e.stdout, e.message]) {
			if (typeof stream === 'string' && isGhAuthFailureMessage(stream)) return true
		}
	}
	return false
}

/** Read the `message` field of a parsed JSON body, when present (gh's exit-0 error envelope). */
function messageInJson(data: unknown): string | undefined {
	if (data && typeof data === 'object' && 'message' in data) {
		const msg = (data as { message: unknown }).message
		return typeof msg === 'string' ? msg : undefined
	}
	return undefined
}

/**
 * Classify a raw gh execution outcome. Pure — exercised directly in tests so
 * the auth-guard mapping is verified without spawning gh.
 */
export function classifyGhOutcome<T>(outcome: GhExecOutcome): GithubVerdict<T> {
	if ('stdout' in outcome) {
		let data: T
		try {
			data = JSON.parse(outcome.stdout) as T
		} catch {
			return { kind: 'error' }
		}
		const message = messageInJson(data)
		if (message !== undefined && isGhAuthFailureMessage(message)) {
			return { kind: 'unauthenticated' }
		}
		if (message !== undefined && isGhRateLimitMessage(message)) {
			// Transient throttle embedded in an exit-0 body — skip, never latch.
			return { kind: 'error' }
		}
		return { kind: 'ok', data }
	}
	if (authFailureInError(outcome.execError)) {
		return { kind: 'unauthenticated' }
	}
	// Any other exec failure (rate limit, network, no-PR-found) is a transient skip.
	return { kind: 'error' }
}

/** Minimal GraphQL envelope we read off a 2xx body. */
interface GraphqlEnvelope<T> {
	data?: T
	errors?: Array<{ type?: unknown; message?: unknown }>
}

/**
 * Classify a raw GraphQL HTTP response. A hard 401 / "Bad credentials" is the
 * token equivalent of the gh path's silent-auth guard. Rate/abuse limits
 * (403/429, "rate limit exceeded") are transient for an authenticated caller,
 * so they map to a skip-this-call `error` and NEVER latch — same reasoning as
 * the gh path (see {@link isGhRateLimitMessage}).
 */
export function classifyGithubResponse<T>(input: { status: number; body: string }): GithubVerdict<T> {
	const { status, body } = input

	if (status === 401 || isGhAuthFailureMessage(body)) {
		return { kind: 'unauthenticated' }
	}
	if (status === 403 || status === 429 || isGhRateLimitMessage(body)) {
		return { kind: 'error' }
	}
	if (status < 200 || status >= 300) {
		return { kind: 'error' }
	}

	let envelope: GraphqlEnvelope<T>
	try {
		envelope = JSON.parse(body) as GraphqlEnvelope<T>
	} catch {
		return { kind: 'error' }
	}

	if (envelope.errors && envelope.errors.length > 0) {
		// GraphQL can 200-OK with an auth error in the errors array (e.g. a token that
		// authenticates but lacks a scope). Latch only on the hard-auth markers.
		const text = envelope.errors.map((e) => (typeof e?.message === 'string' ? e.message : '')).join(' ')
		if (isGhAuthFailureMessage(text) || /bad credentials/i.test(text)) {
			return { kind: 'unauthenticated' }
		}
		return { kind: 'error' }
	}

	if (envelope.data === undefined || envelope.data === null) {
		return { kind: 'error' }
	}
	return { kind: 'ok', data: envelope.data }
}

/**
 * Classify a raw REST HTTP response. Unlike GraphQL, a REST auth failure
 * surfaces as a real HTTP 401, so status is authoritative — and a 2xx body is
 * the resource itself, returned verbatim. Rate/permission limits (403/429) skip
 * without latching, matching {@link classifyGithubResponse}.
 */
export function classifyGithubRest<T>(input: { status: number; body: string }): GithubVerdict<T> {
	const { status, body } = input

	if (status === 401) {
		return { kind: 'unauthenticated' }
	}
	if (status === 403 || status === 429) {
		return { kind: 'error' }
	}
	if (status < 200 || status >= 300) {
		return { kind: 'error' }
	}

	try {
		return { kind: 'ok', data: JSON.parse(body) as T }
	} catch {
		return { kind: 'error' }
	}
}
