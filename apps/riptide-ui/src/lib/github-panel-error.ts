import { ORPCError } from '@orpc/client'

export const GITHUB_CHECKS_PERMISSION_REQUIRED = 'github_checks_permission_required'

export const GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED = 'github_pull_requests_write_permission_required'

/** The organization's own GitHub policy, an IP allow list or SAML enforcement, blocks the App from the repository. */
export const GITHUB_REPOSITORY_ACCESS_BLOCKED = 'github_repository_access_blocked'

const definedMessage = (error: unknown): string | null =>
	error instanceof ORPCError &&
	error.defined &&
	typeof (error.data as { message?: unknown } | undefined)?.message === 'string'
		? (error.data as { message: string }).message
		: null

// The exact `(code, message)` pair `ensure-stream.effect.ts` emits for a missing Checks grant.
export const isGitHubChecksPermissionError = (error: unknown): boolean =>
	error instanceof ORPCError &&
	error.code === 'BAD_REQUEST' &&
	definedMessage(error) === GITHUB_CHECKS_PERMISSION_REQUIRED

/**
 * What to show under the merge row when a write failed. A `BAD_REQUEST` carries GitHub's own
 * sentence, or the one marker the server uses for a missing Pull requests write grant; anything
 * else is the server or GitHub being unreachable.
 */
export const describeGitHubMutationError = (error: unknown): string => {
	if (error instanceof ORPCError && error.code === 'BAD_REQUEST') {
		const message = definedMessage(error)
		if (message === GITHUB_PULL_REQUESTS_WRITE_PERMISSION_REQUIRED) {
			return 'The GitHub App needs write access to pull requests. An admin can reinstall the GitHub app in settings.'
		}
		if (message === GITHUB_CHECKS_PERMISSION_REQUIRED) {
			return 'The GitHub App needs the Checks permission. Refresh the GitHub connection in settings, then try again.'
		}
		if (message === GITHUB_REPOSITORY_ACCESS_BLOCKED) {
			return "GitHub is blocking the App from this repository. An admin can allow it in the organization's IP allow list or SAML settings."
		}
		if (message) return message
	}
	// Either GitHub dropped the pull request or the branch is no longer one this session is on.
	if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
		return 'That pull request is no longer available on this branch.'
	}
	return 'GitHub could not be reached. Try again in a moment.'
}
