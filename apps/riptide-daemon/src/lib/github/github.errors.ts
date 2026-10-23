import { Data } from 'effect'

/**
 * Public error union for {@link ./github-access.service}. Each tag models the
 * caller's DECISION, not a status code:
 *
 * - {@link GithubUnavailableError} — no usable backend (no gh binary, no env
 *   token). Callers no-op the whole feature.
 * - {@link GithubAuthError} — a hard 401: the process-level auth latch has
 *   tripped (or already was). Callers stop their entire scan/sweep.
 * - {@link GithubRequestError} — transient (rate limit, network, no-PR-found,
 *   unparseable body). Callers skip the current item and continue.
 */

/** No usable GitHub backend this process (gh binary absent and no env token). */
export class GithubUnavailableError extends Data.TaggedError('GithubUnavailableError')<{
	operation: string
}> {}

/** Hard GitHub auth failure — the per-backend latch has tripped for this process. */
export class GithubAuthError extends Data.TaggedError('GithubAuthError')<{
	operation: string
	backend: 'gh' | 'token'
}> {}

/** Transient failure (rate limit, network, no PR found, bad payload) — skip, never latch. */
export class GithubRequestError extends Data.TaggedError('GithubRequestError')<{
	operation: string
	backend: 'gh' | 'token'
}> {}

export type GithubAccessError = GithubUnavailableError | GithubAuthError | GithubRequestError
