import { Effect, Schema } from 'effect'

export const PR_STATUS_META_TYPE = 'pr-meta'
export const PR_STATUS_CHECK_TYPE = 'pr-check'

/** A reviewer's standing objection: their latest review requested changes and said why. */
export const ChangesRequestedReview = Schema.Struct({
	login: Schema.NullOr(Schema.String),
	body: Schema.String,
	submittedAt: Schema.NullOr(Schema.String),
	/** The review on GitHub, where the panel sends the reader for the rest of it. */
	url: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null))),
})

export type ChangesRequestedReviewType = typeof ChangesRequestedReview.Type

// Rows written before a field existed stay on the durable store, so each decodes to
// "not known yet" rather than failing the whole stream.
const notKnownYet = <S extends Schema.Top>(schema: S) =>
	Schema.NullOr(schema).pipe(Schema.withDecodingDefaultTypeKey(Effect.succeed(null)))

// GitHub's `PullRequestMergeMethod` and `MergeStateStatus`, verbatim.
export const MERGE_METHODS = ['MERGE', 'SQUASH', 'REBASE'] as const
export const MergeMethod = Schema.Literals(MERGE_METHODS)
export type MergeMethod = typeof MergeMethod.Type

export const MERGE_STATE_STATUSES = [
	'BEHIND',
	'BLOCKED',
	'CLEAN',
	'DIRTY',
	'DRAFT',
	'HAS_HOOKS',
	'UNKNOWN',
	'UNSTABLE',
] as const
export const MergeStateStatus = Schema.Literals(MERGE_STATE_STATUSES)
export type MergeStateStatus = typeof MergeStateStatus.Type

/**
 * Everything the merge row needs that only the panel query knows, in GitHub's own field names:
 * how GitHub judges the merge, what the App may do about it, the message it would write for each
 * method that writes one, and the merge settings of the repository holding the pull request.
 */
export const PullRequestMergeState = Schema.Struct({
	mergeStateStatus: MergeStateStatus,
	/** Null while auto-merge is off; `enabledBy` is null for an actor whose account is gone. */
	autoMergeRequest: Schema.NullOr(
		Schema.Struct({
			enabledBy: Schema.NullOr(Schema.Struct({ login: Schema.String })),
			mergeMethod: MergeMethod,
		}),
	),
	viewerCanEnableAutoMerge: Schema.Boolean,
	viewerCanDisableAutoMerge: Schema.Boolean,
	viewerCanUpdateBranch: Schema.Boolean,
	/** A rebase writes no commit of its own, so only these two methods carry a message. */
	mergeHeadline: Schema.String,
	mergeBody: Schema.String,
	squashHeadline: Schema.String,
	squashBody: Schema.String,
	/** `commits.totalCount`, the one field GraphQL cannot hand over flat. */
	commitCount: Schema.Int,
	mergeCommitAllowed: Schema.Boolean,
	squashMergeAllowed: Schema.Boolean,
	rebaseMergeAllowed: Schema.Boolean,
	viewerDefaultMergeMethod: MergeMethod,
})
export type PullRequestMergeStateType = typeof PullRequestMergeState.Type

export class PullRequestRow extends Schema.Class<PullRequestRow>('PullRequestRow')({
	id: Schema.String,
	number: Schema.Number,
	title: Schema.String,
	url: Schema.String,
	state: Schema.Literals(['open', 'closed', 'merged']),
	isDraft: Schema.Boolean,
	headRef: Schema.String,
	baseRef: Schema.String,
	headSha: Schema.String,
	mergeable: Schema.NullOr(Schema.Boolean),
	reviewDecision: Schema.NullOr(Schema.Literals(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])),
	/** Threads on the pull request; null until a panel query has counted them. */
	unresolvedThreadCount: notKnownYet(Schema.Int),
	resolvedThreadCount: notKnownYet(Schema.Int),
	/** Newest first; null until a panel query has read the reviews. */
	changesRequestedReviews: notKnownYet(Schema.Array(ChangesRequestedReview).pipe(Schema.mutable)),
	/** Null until a panel query has asked GitHub how the pull request merges. */
	merge: notKnownYet(PullRequestMergeState),
}) {}

export type PullRequestRowType = typeof PullRequestRow.Type
export const PullRequestRowStandardSchema = Schema.toStandardSchemaV1(PullRequestRow)

// GitHub's `CheckStatusState` and `CheckConclusionState`, verbatim. Webhook payloads spell the
// same values in lower case; the webhook mapper upper-cases them so the stream has one vocabulary.
export const CHECK_STATUSES = ['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'PENDING', 'REQUESTED', 'WAITING'] as const

export const CHECK_CONCLUSIONS = [
	'ACTION_REQUIRED',
	'CANCELLED',
	'FAILURE',
	'NEUTRAL',
	'SKIPPED',
	'STALE',
	'STARTUP_FAILURE',
	'SUCCESS',
	'TIMED_OUT',
] as const

export class CheckRow extends Schema.Class<CheckRow>('CheckRow')({
	id: Schema.String,
	name: Schema.String,
	headSha: Schema.String,
	status: Schema.Literals(CHECK_STATUSES),
	conclusion: Schema.NullOr(Schema.Literals(CHECK_CONCLUSIONS)),
	detailsUrl: Schema.NullOr(Schema.String),
	startedAt: Schema.NullOr(Schema.String),
	completedAt: Schema.NullOr(Schema.String),
}) {}

export type CheckRowType = typeof CheckRow.Type
export type CheckStatus = CheckRowType['status']
export type CheckConclusion = NonNullable<CheckRowType['conclusion']>
export const CheckRowStandardSchema = Schema.toStandardSchemaV1(CheckRow)

// Keyed on the name, not GitHub's node id: a push creates new ids and the stream has no delete,
// so id-keyed rows would accumulate forever. A `kind` prefix keeps a check run and a commit
// status of the same name apart.
export const checkRowId = (input: { readonly kind: 'check_run' | 'status_context'; readonly name: string }): string =>
	`${input.kind}:${input.name}`

const CHECK_STATUS_RANK: Record<CheckStatus, number> = {
	WAITING: 0,
	REQUESTED: 0,
	QUEUED: 0,
	PENDING: 0,
	IN_PROGRESS: 1,
	COMPLETED: 2,
}

const startedAtMillis = (row: CheckRowType): number => {
	if (!row.startedAt) return 0
	const parsed = Date.parse(row.startedAt)
	return Number.isFinite(parsed) ? parsed : 0
}

// The stream is last-write-wins and its writes are not ordered (two webhook fibers, or a
// hydration snapshot older than an applied webhook), so readers fold through this instead of
// trusting the collection's value. A later start is a later run; on a tie the further stage wins.
export const supersedesCheckRow = (candidate: CheckRowType, existing: CheckRowType): boolean => {
	const candidateStartedAt = startedAtMillis(candidate)
	const existingStartedAt = startedAtMillis(existing)
	if (candidateStartedAt !== existingStartedAt) return candidateStartedAt > existingStartedAt
	return CHECK_STATUS_RANK[candidate.status] > CHECK_STATUS_RANK[existing.status]
}

export const mergeCheckRows = (
	held: ReadonlyMap<string, CheckRowType>,
	incoming: readonly CheckRowType[],
): ReadonlyMap<string, CheckRowType> => {
	let merged: Map<string, CheckRowType> | null = null
	for (const row of incoming) {
		const existing = (merged ?? held).get(row.id)
		if (existing && !supersedesCheckRow(row, existing)) continue
		merged ??= new Map(held)
		merged.set(row.id, row)
	}
	return merged ?? held
}

// Read from the checks rather than the pull request row: the row is written once at hydration
// while check rows keep arriving by webhook, so after a push the checks name the new commit first.
export const currentCheckHeadSha = (input: {
	readonly pullRequest: { readonly headSha: string } | null
	readonly checks: readonly CheckRowType[]
}): string | null => {
	let newest: CheckRowType | null = null
	for (const check of input.checks) {
		if (!check.headSha) continue
		if (!newest || startedAtMillis(check) > startedAtMillis(newest)) newest = check
	}
	if (newest) return newest.headSha
	return input.pullRequest?.headSha ? input.pullRequest.headSha : null
}

export const checksOnCurrentCommit = (input: {
	readonly pullRequest: { readonly headSha: string } | null
	readonly checks: readonly CheckRowType[]
}): CheckRowType[] => {
	const headSha = currentCheckHeadSha(input)
	if (headSha === null) return [...input.checks]
	return input.checks.filter((check) => check.headSha === headSha)
}

export interface PrStatusKey {
	readonly organizationId: string
	readonly repoFullName: string
	readonly branch: string
}

// Both `repoFullName` and `branch` contain `/`, so a missed decode on the far side produces a
// Hono 404 that is indistinguishable from "stream does not exist".
export const prStatusStreamPath = (key: PrStatusKey): string =>
	`/organizations/${key.organizationId}` +
	`/github/repos/${encodeURIComponent(key.repoFullName.toLowerCase())}` +
	`/branches/${encodeURIComponent(key.branch)}/pr-status`

// `headers.operation` is writer-owned and unvalidated by the server, so getting it wrong is a
// silent data bug.
const encodeEnvelope = (type: string, row: { readonly id: string }, timestamp: string): string =>
	JSON.stringify({
		type,
		key: row.id,
		value: row,
		headers: { operation: 'upsert', timestamp, from: 'riptide-api' },
	})

export const encodePullRequestEnvelope = (row: PullRequestRowType, timestamp: string): string =>
	encodeEnvelope(PR_STATUS_META_TYPE, row, timestamp)

export const encodeCheckEnvelope = (row: CheckRowType, timestamp: string): string =>
	encodeEnvelope(PR_STATUS_CHECK_TYPE, row, timestamp)
