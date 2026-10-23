import { Data } from 'effect'

import type { GitHubMissingPermissionDetail } from './github.permissions'

export class GitHubProviderTransportError extends Data.TaggedError('GitHubProviderTransportError')<{
	readonly operation: string
	readonly cause: unknown
}> {}

export class GitHubProviderResponseError extends Data.TaggedError('GitHubProviderResponseError')<{
	readonly operation: string
	readonly status: number
	readonly cause?: unknown
}> {}

export class GitHubProviderDecodeError extends Data.TaggedError('GitHubProviderDecodeError')<{
	readonly operation: string
	readonly cause: unknown
}> {}

/**
 * GitHub answered the query and refused part of what it selected: `errors[]` carried a
 * `FORBIDDEN`. A refusal names the denied nodes rather than the whole document, so the paths are
 * the only evidence of which grant is missing. Not a member of `GitHubProviderError`: a refusal
 * is a decision about the caller's installation, and the callers that make a provider failure an
 * outage must not fold this one in with it.
 */
export class GitHubProviderForbiddenError extends Data.TaggedError('GitHubProviderForbiddenError')<{
	readonly operation: string
	readonly paths: readonly string[]
	readonly messages: string
}> {}

/**
 * GitHub refused the document at its root: `errors[]` carried a `FORBIDDEN` at path `repository`.
 * Every installation holds `metadata:read`, so the root resolving is never a matter of the grant;
 * a refusal there is the organization's own policy, an IP allow list or SAML enforcement, standing
 * between the App and the repository. Kept apart from `GitHubProviderForbiddenError` so it is not
 * answered with an invitation to refresh a grant that would change nothing.
 */
export class GitHubProviderAccessBlockedError extends Data.TaggedError('GitHubProviderAccessBlockedError')<{
	readonly operation: string
	readonly paths: readonly string[]
	readonly messages: string
}> {}

export type GitHubProviderError = GitHubProviderTransportError | GitHubProviderResponseError | GitHubProviderDecodeError

export class GitHubJwtSigningError extends Data.TaggedError('GitHubJwtSigningError')<{
	readonly cause: unknown
}> {}

export class GitHubInstallStateInvalidError extends Data.TaggedError('GitHubInstallStateInvalidError')<{
	readonly reason: 'invalid_or_expired'
}> {}

export class GitHubConnectionConflictError extends Data.TaggedError('GitHubConnectionConflictError')<{
	readonly installationId: string
}> {}

export class GitHubConnectionNotFoundError extends Data.TaggedError('GitHubConnectionNotFoundError')<{
	readonly connectionId: string
}> {}

export class GitHubRepositoryNotAccessibleError extends Data.TaggedError('GitHubRepositoryNotAccessibleError')<{
	readonly repositoryId: string
}> {}

export class GitHubIssueInputInvalidError extends Data.TaggedError('GitHubIssueInputInvalidError')<{
	readonly reason: 'invalid_format' | 'repository_mismatch'
}> {}

export class GitHubIssueNotFoundError extends Data.TaggedError('GitHubIssueNotFoundError')<{
	readonly issueNumber: number
}> {}

export class GitHubTaskNotFoundError extends Data.TaggedError('GitHubTaskNotFoundError')<{
	readonly taskId: string
}> {}

/**
 * GitHub answered a pull request write with a reason rather than a result: the branch moved
 * under the merge, a required check is failing, auto-merge is off for the repository. The
 * message is GitHub's own sentence and is shown to the user as it is.
 */
export class GitHubPullRequestMutationRejectedError extends Data.TaggedError('GitHubPullRequestMutationRejectedError')<{
	readonly mutation: string
	readonly message: string
}> {}

/** The pull request the write names is not on GitHub, or not on the repository it names. */
export class GitHubPullRequestNotFoundError extends Data.TaggedError('GitHubPullRequestNotFoundError')<{
	readonly repoFullName: string
	readonly number: number
}> {}

/**
 * The organization's own GitHub policy, an IP allow list or SAML enforcement, blocks the App from
 * the repository. Not a grant and not an outage: nothing on this side changes it, and the
 * message is GitHub's own sentence naming the policy.
 */
export class GitHubRepositoryAccessBlockedError extends Data.TaggedError('GitHubRepositoryAccessBlockedError')<{
	readonly repoFullName: string
	readonly messages: string
}> {}

export class GitHubIntegrationDisabledError extends Data.TaggedError('GitHubIntegrationDisabledError')<{}> {}

export class GitHubIntegrationUnavailableError extends Data.TaggedError('GitHubIntegrationUnavailableError')<{
	readonly cause: unknown
}> {}

/**
 * The installation is suspended in GitHub. Suspension is a distinct lifecycle from
 * reauthorization: the binding, permissions, and repository inventory remain, but GitHub
 * blocks installation access until the suspending party reverses it. Carries only the safe
 * remediation fields the settings surface renders (who suspended it and when).
 */
export class GitHubInstallationSuspendedError extends Data.TaggedError('GitHubInstallationSuspendedError')<{
	readonly connectionId: string
	readonly suspendedAt: number | null
	readonly suspendedByLogin: string | null
}> {}

/**
 * A capability the operation needs is not usable. `installation_grant` is the persisted grant
 * failing a capability's minimum requirement, checked before any provider call. `github_refusal`
 * is GitHub refusing nodes the document selected even though the persisted grant satisfies every
 * capability it declares: an installation keeps the grant set it was installed with until an
 * owner accepts a permission the App added later, so the persisted row is stale and the
 * connection needs refreshing. Neither is derived from a `401`/`403` status code.
 *
 * `missing` carries every unusable capability, not the first, so the remediation can name them
 * all. Fields are safe permission names and levels.
 */
export class GitHubMissingPermissionsError extends Data.TaggedError('GitHubMissingPermissionsError')<{
	readonly missing: readonly GitHubMissingPermissionDetail[]
	readonly detectedBy: 'installation_grant' | 'github_refusal'
}> {}

/**
 * The webhook `X-Hub-Signature-256` header was missing or did not match the HMAC recomputed
 * over the exact raw body. Attacker-triggerable, so the route maps this to `401` and
 * warn-logs it (no Sentry). Models the caller-actionable decision, not the HTTP status.
 */
export class GitHubWebhookSignatureInvalidError extends Data.TaggedError('GitHubWebhookSignatureInvalidError')<{
	readonly reason: string
}> {}

/**
 * The webhook was authentic (signature verified) but its body could not be parsed into a
 * supported installation envelope. The route maps this to `400` (client error).
 */
export class GitHubWebhookMalformedRequestError extends Data.TaggedError('GitHubWebhookMalformedRequestError')<{
	readonly reason: string
}> {}

/**
 * The GitHub-side uninstall could not be confirmed, so local state is preserved and the
 * settings UI is told the disconnect did not complete. The provider failure is captured
 * before this narrowed value is returned.
 */
export class GitHubDisconnectFailedError extends Data.TaggedError('GitHubDisconnectFailedError')<{
	readonly connectionId: string
	readonly cause: unknown
}> {}
