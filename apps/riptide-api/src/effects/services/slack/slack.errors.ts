import { Data } from 'effect'

export class SlackOAuthError extends Data.TaggedError('SlackOAuthError')<{
	code?: string
	cause?: unknown
}> {}

export class SlackTokenRevokedError extends Data.TaggedError('SlackTokenRevokedError')<{
	code?: string
	cause?: unknown
}> {}

export class SlackMissingScopeError extends Data.TaggedError('SlackMissingScopeError')<{
	needed?: string
	provided?: string
	cause?: unknown
}> {}

export class SlackNotInChannelError extends Data.TaggedError('SlackNotInChannelError')<{
	channelId: string
	code?: string
	cause?: unknown
}> {}

export class SlackChannelNotFoundError extends Data.TaggedError('SlackChannelNotFoundError')<{
	channelId: string
	code?: string
	cause?: unknown
}> {}

export class SlackRateLimitError extends Data.TaggedError('SlackRateLimitError')<{
	retryAfterMs?: number
	cause?: unknown
}> {}

export class SlackApiUnavailableError extends Data.TaggedError('SlackApiUnavailableError')<{
	cause?: unknown
}> {}

export class SlackUnexpectedResponseError extends Data.TaggedError('SlackUnexpectedResponseError')<{
	code?: string
	cause?: unknown
}> {}

export class SlackNotConnectedError extends Data.TaggedError('SlackNotConnectedError')<{
	organizationId: string
}> {}

export class SlackInstallStateInvalidError extends Data.TaggedError('SlackInstallStateInvalidError')<{
	reason?: string
}> {}

export class SlackNeedsReauthError extends Data.TaggedError('SlackNeedsReauthError')<{
	organizationId: string
	lastErrorCode?: string
}> {}

export class SlackIntegrationUnavailableError extends Data.TaggedError('SlackIntegrationUnavailableError')<{
	cause?: unknown
}> {}

/**
 * The interaction request signature was missing or did not match the recomputed
 * HMAC. Attacker-triggerable, so the route maps this to `401` and warn-logs it
 * (no Sentry). Models the caller-actionable decision — "reject as unauthenticated" —
 * not the HTTP status.
 */
export class SlackWebhookSignatureInvalidError extends Data.TaggedError('SlackWebhookSignatureInvalidError')<{
	reason?: string
}> {}

/**
 * The `X-Slack-Request-Timestamp` was missing or outside Slack's 5-minute replay
 * window. Rejected before the signature is trusted; the route maps this to `401`.
 */
export class SlackWebhookRequestTooOldError extends Data.TaggedError('SlackWebhookRequestTooOldError')<{
	ageSeconds?: number
}> {}

/**
 * The request was authentic (signature + timestamp verified) but its `payload`
 * form field was missing or not valid JSON. The route maps this to `400`.
 */
export class SlackWebhookMalformedRequestError extends Data.TaggedError('SlackWebhookMalformedRequestError')<{
	reason?: string
}> {}
