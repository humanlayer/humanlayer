import { createHmac, timingSafeEqual } from 'node:crypto'

import { CheckRow, type CheckRowType, PullRequestRow } from '@humanlayer/streams/pr-status'
import { Effect } from 'effect'
import * as Schema from 'effect/Schema'

import { GitHubWebhookMalformedRequestError } from './github.errors'
import { GitHubDecimalId, parseGitHubJsonPreservingIntegerLexemes } from './github.schema'
import { PullRequestAuthor, PullRequestLifecycleTimes } from './pull-requests/delivery'
import {
	checkConclusionFromWebhook,
	checkStatusFromWebhook,
	pullRequestRowId,
	toCheckRowFromWebhook,
} from './pull-requests/github-api'

/**
 * Pure functional core for GitHub webhook verification and envelope parsing.
 *
 * GitHub signs each delivery with `X-Hub-Signature-256`: the lowercase hex HMAC-SHA256 of the
 * exact raw request body under the app's webhook secret, prefixed `sha256=`, compared in
 * constant time (see
 * https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries). Nothing
 * here throws — verification/parse failures are returned through the typed error channel so
 * the service shell never reasons about caught exceptions crossing the seam. Mirrors the Slack
 * `slack.interactions.ts` functional-core convention.
 */

const GITHUB_SIGNATURE_PREFIX = 'sha256='

/**
 * Computes the `X-Hub-Signature-256` value for a delivery: HMAC-SHA256 over the exact raw
 * UTF-8 body, hex-encoded, prefixed `sha256=`.
 */
export function computeGitHubSignature(input: { webhookSecret: string; rawBody: string }): string {
	const digest = createHmac('sha256', input.webhookSecret).update(input.rawBody, 'utf8').digest('hex')
	return `${GITHUB_SIGNATURE_PREFIX}${digest}`
}

/**
 * Constant-time comparison of two `sha256=…` signature strings. `crypto.timingSafeEqual`
 * throws on differing lengths, so a length guard short-circuits (mismatched lengths can never
 * be equal) while keeping the comparison side-channel resistant.
 */
export function safeSignatureEqual(expected: string, provided: string): boolean {
	const expectedBuffer = Buffer.from(expected, 'utf8')
	const providedBuffer = Buffer.from(provided, 'utf8')
	if (expectedBuffer.length !== providedBuffer.length) return false
	return timingSafeEqual(expectedBuffer, providedBuffer)
}

const GitHubWebhookSuspendedBy = Schema.Struct({
	login: Schema.NonEmptyString,
	id: GitHubDecimalId,
})

const GitHubWebhookInstallationEnvelope = Schema.Struct({
	id: GitHubDecimalId,
	suspended_at: Schema.optional(Schema.NullOr(Schema.String)),
	suspended_by: Schema.optional(Schema.NullOr(GitHubWebhookSuspendedBy)),
})

/**
 * The minimal, security-relevant shape shared by the `installation` and
 * `installation_repositories` events. Correctness comes from current-state reconciliation and
 * idempotent deletion, so only the installation identity (and suspension actor for `suspend`)
 * is parsed from the payload — never the full permission/repository delta.
 */
const GitHubWebhookEnvelope = Schema.Struct({
	action: Schema.String,
	installation: GitHubWebhookInstallationEnvelope,
})

// `head_branch` is null for a run on a fork pull request, so there is no stream key to invent.
const GitHubCheckWebhookEnvelope = Schema.Struct({
	action: Schema.String,
	installation: Schema.Struct({ id: GitHubDecimalId }),
	repository: Schema.Struct({ full_name: Schema.NonEmptyString }),
	check_run: Schema.Struct({
		name: Schema.NonEmptyString,
		head_sha: Schema.NonEmptyString,
		status: Schema.String,
		conclusion: Schema.optional(Schema.NullOr(Schema.String)),
		details_url: Schema.optional(Schema.NullOr(Schema.String)),
		started_at: Schema.optional(Schema.NullOr(Schema.String)),
		completed_at: Schema.optional(Schema.NullOr(Schema.String)),
		check_suite: Schema.Struct({
			head_branch: Schema.optional(Schema.NullOr(Schema.String)),
		}),
	}),
})

const GitHubWebhookActor = Schema.Struct({
	login: Schema.NonEmptyString,
	id: GitHubDecimalId,
	type: Schema.optional(Schema.NullOr(Schema.String)),
})

const GitHubWebhookRepository = Schema.Struct({ full_name: Schema.NonEmptyString })

/** `head.repo` is null once a fork is deleted; a head on the repository itself always has one. */
const GitHubWebhookPullRequestHead = Schema.Struct({
	ref: Schema.NonEmptyString,
	repo: Schema.NullOr(GitHubWebhookRepository),
})

// Every `pull_request` action carries the whole pull request, so one envelope serves them all.
// `mergeable` is null while GitHub is still computing it; a review decision is not in the payload.
const GitHubPullRequestWebhookEnvelope = Schema.Struct({
	action: Schema.String,
	installation: Schema.Struct({ id: GitHubDecimalId }),
	repository: GitHubWebhookRepository,
	pull_request: Schema.Struct({
		number: GitHubDecimalId,
		title: Schema.String,
		html_url: Schema.NonEmptyString,
		state: Schema.String,
		draft: Schema.optional(Schema.NullOr(Schema.Boolean)),
		merged: Schema.optional(Schema.NullOr(Schema.Boolean)),
		mergeable: Schema.optional(Schema.NullOr(Schema.Boolean)),
		head: Schema.Struct({ ...GitHubWebhookPullRequestHead.fields, sha: Schema.String }),
		base: Schema.Struct({ ref: Schema.String }),
		user: Schema.optional(Schema.NullOr(GitHubWebhookActor)),
		merged_by: Schema.optional(Schema.NullOr(GitHubWebhookActor)),
		created_at: Schema.optional(Schema.NullOr(Schema.String)),
		merged_at: Schema.optional(Schema.NullOr(Schema.String)),
		closed_at: Schema.optional(Schema.NullOr(Schema.String)),
	}),
})

// A review, a review comment or a thread being resolved changes what only the panel query reports
// (`reviewDecision`, the thread counts, the review bodies), so the event carries the branch to
// refetch and nothing else. All three payloads carry the pull request the same way.
const GitHubPullRequestReviewWebhookEnvelope = Schema.Struct({
	action: Schema.String,
	installation: Schema.Struct({ id: GitHubDecimalId }),
	repository: GitHubWebhookRepository,
	pull_request: Schema.Struct({
		number: GitHubDecimalId,
		head: GitHubWebhookPullRequestHead,
	}),
})

/**
 * `head.ref` is the fork's branch name too, so a fork's same-named branch would land on ours.
 * The same rule `selectPanelPullRequest` applies to the GraphQL answer: only a head on the
 * repository the delivery is for counts.
 */
const headIsOnRepository = (envelope: {
	readonly repository: typeof GitHubWebhookRepository.Type
	readonly pull_request: { readonly head: typeof GitHubWebhookPullRequestHead.Type }
}): boolean => envelope.pull_request.head.repo?.full_name.toLowerCase() === envelope.repository.full_name.toLowerCase()

/** Why a delivery triggers full current-state reconciliation. */
export const GitHubReconcileReason = Schema.Literals([
	'created',
	'unsuspend',
	'new_permissions_accepted',
	'repositories_changed',
])
export type GitHubReconcileReason = typeof GitHubReconcileReason.Type

const GitHubReconcileWebhookEvent = Schema.Struct({
	type: Schema.tag('reconcile'),
	installationId: Schema.String,
	reason: GitHubReconcileReason,
	deliveryId: Schema.NullOr(Schema.String),
})

const GitHubSuspendWebhookEvent = Schema.Struct({
	type: Schema.tag('suspend'),
	installationId: Schema.String,
	suspendedAt: Schema.NullOr(Schema.Number),
	suspendedById: Schema.NullOr(Schema.String),
	suspendedByLogin: Schema.NullOr(Schema.String),
	deliveryId: Schema.NullOr(Schema.String),
})

const GitHubDeleteWebhookEvent = Schema.Struct({
	type: Schema.tag('delete'),
	installationId: Schema.String,
	deliveryId: Schema.NullOr(Schema.String),
})

const GitHubIgnoredWebhookEvent = Schema.Struct({
	type: Schema.tag('ignored'),
	event: Schema.String,
	action: Schema.NullOr(Schema.String),
	deliveryId: Schema.NullOr(Schema.String),
})

export const GitHubPrChecksChangedWebhookEvent = Schema.Struct({
	type: Schema.tag('pr_checks_changed'),
	installationId: Schema.String,
	repoFullName: Schema.String,
	branch: Schema.String,
	checks: Schema.Array(CheckRow),
	deliveryId: Schema.NullOr(Schema.String),
})
export type GitHubPrChecksChangedWebhookEvent = typeof GitHubPrChecksChangedWebhookEvent.Type

export const GitHubPrChangedWebhookEvent = Schema.Struct({
	type: Schema.tag('pr_changed'),
	installationId: Schema.String,
	repoFullName: Schema.String,
	branch: Schema.String,
	/** GitHub's `pull_request` action name: `opened`, `synchronize`, `auto_merge_enabled`, and so on. */
	action: Schema.String,
	pullRequest: PullRequestRow,
	author: PullRequestAuthor,
	timestamps: PullRequestLifecycleTimes,
	deliveryId: Schema.NullOr(Schema.String),
})
export type GitHubPrChangedWebhookEvent = typeof GitHubPrChangedWebhookEvent.Type

export const GitHubPrReviewedWebhookEvent = Schema.Struct({
	type: Schema.tag('pr_reviewed'),
	installationId: Schema.String,
	repoFullName: Schema.String,
	branch: Schema.String,
	deliveryId: Schema.NullOr(Schema.String),
})
export type GitHubPrReviewedWebhookEvent = typeof GitHubPrReviewedWebhookEvent.Type

/**
 * The parsed, verified webhook as a trusted in-process control-flow value. `handleWebhook`
 * dispatches on `type`; the raw payload delta is never persisted as source of truth.
 */
export const GitHubWebhookEvent = Schema.Union([
	GitHubReconcileWebhookEvent,
	GitHubSuspendWebhookEvent,
	GitHubDeleteWebhookEvent,
	GitHubPrChecksChangedWebhookEvent,
	GitHubPrChangedWebhookEvent,
	GitHubPrReviewedWebhookEvent,
	GitHubIgnoredWebhookEvent,
])
export type GitHubWebhookEvent = typeof GitHubWebhookEvent.Type

const parseSuspendedAt = (value: string | null | undefined): number | null => {
	if (!value) return null
	const millis = Date.parse(value)
	return Number.isFinite(millis) ? millis : null
}

const parseIsoMillis = (value: string | null | undefined): number | null => {
	if (!value) return null
	const millis = Date.parse(value)
	return Number.isFinite(millis) ? millis : null
}

const decodeGitHubWebhookEnvelope = Schema.decodeUnknownEffect(GitHubWebhookEnvelope)
const decodeGitHubCheckWebhookEnvelope = Schema.decodeUnknownEffect(GitHubCheckWebhookEnvelope)
const decodeGitHubPullRequestWebhookEnvelope = Schema.decodeUnknownEffect(GitHubPullRequestWebhookEnvelope)
const decodeGitHubPullRequestReviewWebhookEnvelope = Schema.decodeUnknownEffect(GitHubPullRequestReviewWebhookEnvelope)

const mapPullRequestEnvelopeToEvent = (
	envelope: typeof GitHubPullRequestWebhookEnvelope.Type,
	deliveryId: string | null,
): GitHubWebhookEvent => {
	if (!headIsOnRepository(envelope)) {
		return { type: 'ignored', event: 'pull_request', action: envelope.action, deliveryId }
	}
	const pullRequest = envelope.pull_request
	const repoFullName = envelope.repository.full_name.toLowerCase()
	const state = pullRequest.merged ? 'merged' : pullRequest.state === 'closed' ? 'closed' : 'open'
	return {
		type: 'pr_changed',
		installationId: envelope.installation.id,
		repoFullName,
		branch: pullRequest.head.ref,
		action: envelope.action,
		pullRequest: {
			id: pullRequestRowId({ repoFullName, branch: pullRequest.head.ref }),
			number: Number(pullRequest.number),
			title: pullRequest.title,
			url: pullRequest.html_url,
			state,
			isDraft: pullRequest.draft ?? false,
			headRef: pullRequest.head.ref,
			baseRef: pullRequest.base.ref,
			headSha: pullRequest.head.sha,
			mergeable: pullRequest.mergeable ?? null,
			reviewDecision: null,
			unresolvedThreadCount: null,
			resolvedThreadCount: null,
			changesRequestedReviews: null,
			merge: null,
		},
		author: {
			login: pullRequest.user?.login ?? null,
			id: pullRequest.user?.id ?? null,
			isBot: pullRequest.user?.type === 'Bot',
		},
		timestamps: {
			openedAt: parseIsoMillis(pullRequest.created_at),
			mergedAt: parseIsoMillis(pullRequest.merged_at),
			closedAt: parseIsoMillis(pullRequest.closed_at),
			mergedByLogin: pullRequest.merged_by?.login ?? null,
		},
		deliveryId,
	}
}

const REVIEW_EVENTS = ['pull_request_review', 'pull_request_review_comment', 'pull_request_review_thread'] as const

const mapPullRequestReviewEnvelopeToEvent =
	(event: (typeof REVIEW_EVENTS)[number]) =>
	(envelope: typeof GitHubPullRequestReviewWebhookEnvelope.Type, deliveryId: string | null): GitHubWebhookEvent =>
		headIsOnRepository(envelope)
			? {
					type: 'pr_reviewed',
					installationId: envelope.installation.id,
					repoFullName: envelope.repository.full_name.toLowerCase(),
					branch: envelope.pull_request.head.ref,
					deliveryId,
				}
			: { type: 'ignored', event, action: envelope.action, deliveryId }

/** The check run as a stream row, or null when it speaks a status or conclusion we do not carry. */
const toCheckRowFromEnvelope = (checkRun: typeof GitHubCheckWebhookEnvelope.Type.check_run): CheckRowType | null => {
	const status = checkStatusFromWebhook(checkRun.status)
	if (!status) return null
	const reported = checkRun.conclusion ?? null
	const conclusion = reported === null ? null : checkConclusionFromWebhook(reported)
	if (reported !== null && conclusion === null) return null
	return toCheckRowFromWebhook({
		name: checkRun.name,
		headSha: checkRun.head_sha,
		status,
		conclusion,
		detailsUrl: checkRun.details_url ?? null,
		startedAt: checkRun.started_at ?? null,
		completedAt: checkRun.completed_at ?? null,
	})
}

const mapCheckEnvelopeToEvent = (
	envelope: typeof GitHubCheckWebhookEnvelope.Type,
	deliveryId: string | null,
): GitHubWebhookEvent => {
	const branch = envelope.check_run.check_suite.head_branch
	const row = toCheckRowFromEnvelope(envelope.check_run)
	if (!branch || !row) return { type: 'ignored', event: 'check_run', action: envelope.action, deliveryId }
	return {
		type: 'pr_checks_changed',
		installationId: envelope.installation.id,
		repoFullName: envelope.repository.full_name.toLowerCase(),
		branch,
		checks: [row],
		deliveryId,
	}
}

const mapEnvelopeToEvent = (
	eventType: 'installation' | 'installation_repositories',
	envelope: typeof GitHubWebhookEnvelope.Type,
	deliveryId: string | null,
): GitHubWebhookEvent => {
	const installationId = envelope.installation.id
	if (eventType === 'installation_repositories') {
		return { type: 'reconcile', installationId, reason: 'repositories_changed', deliveryId }
	}
	switch (envelope.action) {
		case 'created':
			return { type: 'reconcile', installationId, reason: 'created', deliveryId }
		case 'unsuspend':
			return { type: 'reconcile', installationId, reason: 'unsuspend', deliveryId }
		case 'new_permissions_accepted':
			return { type: 'reconcile', installationId, reason: 'new_permissions_accepted', deliveryId }
		case 'suspend':
			return {
				type: 'suspend',
				installationId,
				suspendedAt: parseSuspendedAt(envelope.installation.suspended_at),
				suspendedById: envelope.installation.suspended_by?.id ?? null,
				suspendedByLogin: envelope.installation.suspended_by?.login ?? null,
				deliveryId,
			}
		case 'deleted':
			return { type: 'delete', installationId, deliveryId }
		default:
			return { type: 'ignored', event: eventType, action: envelope.action, deliveryId }
	}
}

/** Decodes one delivery body with the envelope its event type uses, then reads it as an event. */
type EnvelopeReader = (
	parsed: unknown,
	deliveryId: string | null,
) => Effect.Effect<GitHubWebhookEvent, GitHubWebhookMalformedRequestError>

const readAs =
	<A, E extends { readonly message: string }>(
		decode: (parsed: unknown) => Effect.Effect<A, E>,
		mismatch: string,
		toEvent: (envelope: A, deliveryId: string | null) => GitHubWebhookEvent,
	): EnvelopeReader =>
	(parsed, deliveryId) =>
		decode(parsed).pipe(
			Effect.mapError(
				(cause) => new GitHubWebhookMalformedRequestError({ reason: `${mismatch}: ${cause.message}` }),
			),
			Effect.map((envelope) => toEvent(envelope, deliveryId)),
		)

// `check_suite` is absent deliberately: its payload has no per-run identity, and each run it
// summarises arrives as its own `check_run` delivery.
const EVENT_READERS = {
	check_run: readAs(decodeGitHubCheckWebhookEnvelope, 'check_envelope_mismatch', mapCheckEnvelopeToEvent),
	pull_request: readAs(
		decodeGitHubPullRequestWebhookEnvelope,
		'pull_request_envelope_mismatch',
		mapPullRequestEnvelopeToEvent,
	),
	pull_request_review: readAs(
		decodeGitHubPullRequestReviewWebhookEnvelope,
		'pull_request_review_envelope_mismatch',
		mapPullRequestReviewEnvelopeToEvent('pull_request_review'),
	),
	pull_request_review_comment: readAs(
		decodeGitHubPullRequestReviewWebhookEnvelope,
		'pull_request_review_comment_envelope_mismatch',
		mapPullRequestReviewEnvelopeToEvent('pull_request_review_comment'),
	),
	pull_request_review_thread: readAs(
		decodeGitHubPullRequestReviewWebhookEnvelope,
		'pull_request_review_thread_envelope_mismatch',
		mapPullRequestReviewEnvelopeToEvent('pull_request_review_thread'),
	),
	installation: readAs(decodeGitHubWebhookEnvelope, 'envelope_mismatch', (envelope, deliveryId) =>
		mapEnvelopeToEvent('installation', envelope, deliveryId),
	),
	installation_repositories: readAs(decodeGitHubWebhookEnvelope, 'envelope_mismatch', (envelope, deliveryId) =>
		mapEnvelopeToEvent('installation_repositories', envelope, deliveryId),
	),
}

const isReadableEvent = (eventType: string | null): eventType is keyof typeof EVENT_READERS =>
	eventType !== null && eventType in EVENT_READERS

/**
 * Parses an authentic (signature-verified) delivery into a domain event. An unknown event
 * type is safely ignored (acknowledged, never a client error); a supported event with an
 * unparseable body is a malformed client error. Delivery ID is retained only for safe trace
 * correlation.
 */
export const parseGitHubWebhookEvent = (input: {
	readonly rawBody: string
	readonly eventType: string | null
	readonly deliveryId: string | null
}): Effect.Effect<GitHubWebhookEvent, GitHubWebhookMalformedRequestError> => {
	const { eventType, deliveryId } = input
	if (!isReadableEvent(eventType)) {
		return Effect.succeed({ type: 'ignored', event: eventType ?? 'unknown', action: null, deliveryId })
	}
	const read = EVENT_READERS[eventType]
	return Effect.try({
		try: () => parseGitHubJsonPreservingIntegerLexemes(input.rawBody),
		catch: (cause) =>
			new GitHubWebhookMalformedRequestError({
				reason: cause instanceof Error ? `invalid_json: ${cause.message}` : 'invalid_json',
			}),
	}).pipe(Effect.flatMap((parsed) => read(parsed, deliveryId)))
}

/**
 * Projects a verified webhook event to the safe, structured fields the module logs — no
 * secrets, no signature, no full payload.
 */
export function webhookLogFields(event: GitHubWebhookEvent) {
	const base = { event_type: event.type, delivery_id: event.deliveryId ?? undefined }
	switch (event.type) {
		case 'reconcile':
			return { ...base, installation_id: event.installationId, reason: event.reason }
		case 'suspend':
			return { ...base, installation_id: event.installationId, has_suspended_by: event.suspendedByLogin !== null }
		case 'delete':
			return { ...base, installation_id: event.installationId }
		case 'pr_checks_changed':
			return {
				...base,
				installation_id: event.installationId,
				repo_full_name: event.repoFullName,
				branch: event.branch,
				check_count: event.checks.length,
			}
		case 'pr_changed':
			return {
				...base,
				installation_id: event.installationId,
				repo_full_name: event.repoFullName,
				branch: event.branch,
				number: event.pullRequest.number,
				state: event.pullRequest.state,
			}
		case 'pr_reviewed':
			return {
				...base,
				installation_id: event.installationId,
				repo_full_name: event.repoFullName,
				branch: event.branch,
			}
		case 'ignored':
			return { ...base, github_event: event.event, action: event.action ?? undefined }
	}
}
