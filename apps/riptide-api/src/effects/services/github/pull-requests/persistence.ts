import { type PullRequest, type PullRequestState, pullRequests } from '@humanlayer/db/tables/pull-requests'
import { toEpochMs } from '@humanlayer/db/utils/epoch-ms'
import { type PullRequestAttributionTier, pullRequestTierRank } from '@humanlayer/git-attribution'
import type { PullRequestRowType } from '@humanlayer/streams/pr-status'
import { and, desc, eq, or, type SQL, sql, type SQLWrapper } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { PostgresDb, PostgresDbLive } from '../../postgres/postgres-db.service'
import { GitHubIntegrationUnavailableError } from '../github.errors'
import {
	findSessionForBranch,
	findSessionInRepository,
	linkPullRequestSessions,
	type PullRequestSessionLink,
} from './attribution'
import type { PullRequestAuthor, PullRequestLifecycleTimes } from './delivery'
import { capturePullRequestFailure } from './failure'
import { pullRequestRowId } from './github-api'

/**
 * What our own database holds about a pull request: one `pull_requests` row per (org, repo,
 * number), written by the panel's hydration and by `pull_request` deliveries, read back by
 * `listPullRequestBranches`. The stream carries the same row live; this table is what survives
 * the stream. The other direction, what GitHub's API says, lives in `./github-api`.
 */

export interface RecordPullRequestInput {
	readonly organizationId: string
	readonly repoFullName: string
	readonly row: PullRequestRowType
	readonly source: 'app' | 'webhook'
	/**
	 * Who the caller already knows the pull request belongs to, as the panel knows it from the task
	 * it is rendering. Omit it and the head branch decides.
	 */
	readonly owner?: PullRequestSessionLink
	/**
	 * The session the head commit's trailer names. Only the panel query reads the commit message;
	 * it owns the pull request when no session observed the head branch.
	 */
	readonly trailerSessionId?: string
	/** Only a delivery carries the author; the panel query does not ask for it. */
	readonly author?: PullRequestAuthor
	/** Only a delivery carries lifecycle times; the panel query does not ask for them. */
	readonly timestamps?: PullRequestLifecycleTimes
}

export interface RecordedPullRequest {
	/** The stored row as the panel renders it, which keeps what earlier sources knew. */
	readonly panelRow: PullRequestRowType
	readonly attributionMethod: PullRequestAttributionTier | null
	/** False when nothing links the pull request to a session or a task. */
	readonly hasOwner: boolean
}

/**
 * The state lattice, weakest to strongest. That order is the precedence every writer applies, so
 * state only ever advances.
 */
const STORED_PULL_REQUEST_STATES = ['open', 'closed', 'merged'] as const satisfies readonly PullRequestState[]

/** Rank in the lattice; a report at or above the stored rank may replace it. */
export const pullRequestStateRank = (state: PullRequestState): number => STORED_PULL_REQUEST_STATES.indexOf(state)

export interface PullRequestBranchKey {
	readonly repoFullName: string
	readonly branch: string
}

export const toPanelPullRequest = (
	record: Pick<
		PullRequest,
		| 'repo_full_name'
		| 'head_ref'
		| 'number'
		| 'title'
		| 'url'
		| 'state'
		| 'is_draft'
		| 'base_ref'
		| 'head_sha'
		| 'mergeable'
		| 'review_decision'
		| 'unresolved_thread_count'
		| 'resolved_thread_count'
		| 'changes_requested_reviews'
		| 'merge_state'
	>,
): PullRequestRowType => ({
	id: pullRequestRowId({ repoFullName: record.repo_full_name, branch: record.head_ref }),
	number: record.number,
	title: record.title,
	url: record.url,
	state: record.state,
	isDraft: record.is_draft,
	headRef: record.head_ref,
	baseRef: record.base_ref ?? '',
	headSha: record.head_sha ?? '',
	mergeable: record.mergeable,
	reviewDecision: record.review_decision,
	unresolvedThreadCount: record.unresolved_thread_count,
	resolvedThreadCount: record.resolved_thread_count,
	changesRequestedReviews: record.changes_requested_reviews,
	merge: record.merge_state,
})

type PullRequestColumn = keyof PullRequest

/** What only the panel query reports; a delivery never carries any of it. */
const PANEL_QUERY_COLUMNS = [
	'review_decision',
	'unresolved_thread_count',
	'resolved_thread_count',
	'changes_requested_reviews',
	'merge_state',
] as const satisfies readonly PullRequestColumn[]

/** The value the statement is trying to write, as postgres exposes it to the conflict clause. */
const excluded = (column: PullRequestColumn): SQL => sql.raw(`excluded.${column}`)

const mergeEach = <K extends PullRequestColumn>(columns: readonly K[], merge: (column: K) => SQL): Record<K, SQL> =>
	Object.fromEntries(columns.map((column) => [column, merge(column)])) as Record<K, SQL>

/** The report owns the column outright. */
const fromReport = <K extends PullRequestColumn>(...columns: K[]) => mergeEach(columns, excluded)

/** The first source that knew the value keeps it; a later report cannot overwrite it. */
const filledOnce = <K extends PullRequestColumn>(...columns: K[]) =>
	mergeEach(columns, (column) => sql`coalesce(${pullRequests[column]}, ${excluded(column)})`)

/**
 * The owner is the linked session's owner. A row with no session yet takes the owner of the
 * session the report links; a row that already names a session keeps the owner it credited.
 */
const ownerOfLinkedSession = sql`case
	when ${pullRequests.session_id} is null and ${excluded('session_id')} is not null
		then ${excluded('resource_owner_user_id')}
	else coalesce(${pullRequests.resource_owner_user_id}, ${excluded('resource_owner_user_id')})
end`

/** The report wins where it knows the value; where it does not, the stored value stands. */
const reportOrStored = <K extends PullRequestColumn>(...columns: K[]) =>
	mergeEach(columns, (column) => sql`coalesce(${excluded(column)}, ${pullRequests[column]})`)

/**
 * The lattice in SQL: deliveries are unordered and retried, so a re-delivered pre-merge snapshot
 * must not reopen a merged row.
 */
const STATE_ORDER = sql.raw(`array[${STORED_PULL_REQUEST_STATES.map((state) => `'${state}'`).join(',')}]`)
const stateRank = (state: SQLWrapper) => sql`array_position(${STATE_ORDER}, ${state})`

const incomingState = excluded('state')
const advancingState = sql`
	case
		when ${stateRank(incomingState)} >= ${stateRank(pullRequests.state)} then ${incomingState}
		else ${pullRequests.state}
	end`

export const recordPullRequest = (
	input: RecordPullRequestInput,
): Effect.Effect<RecordedPullRequest, GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const now = BigInt(yield* Clock.currentTimeMillis)
		const repoFullName = input.repoFullName.toLowerCase()
		const lifecycleUpdates = input.timestamps
			? filledOnce('opened_at', 'merged_at', 'merged_by_github_login', 'closed_at')
			: {}
		const panelUpdates =
			input.source === 'app' ? fromReport(...PANEL_QUERY_COLUMNS) : reportOrStored(...PANEL_QUERY_COLUMNS)
		return yield* postgres.transaction((transaction) =>
			writeRecordedPullRequest({
				input,
				repoFullName,
				now,
				conflictUpdates: { ...panelUpdates, ...lifecycleUpdates },
			}).pipe(Effect.provide(PostgresDbLive(transaction.client))),
		)
	}).pipe(
		Effect.catchTag(
			'PostgresDbTransactionError',
			capturePullRequestFailure('record_pull_request', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.record', {
			attributes: {
				organization_id: input.organizationId,
				repo_full_name: input.repoFullName,
				number: input.row.number,
				source: input.source,
			},
		}),
	)

/** The upsert, the session links and the credit the links earn, as one transaction. */
const writeRecordedPullRequest = (context: {
	readonly input: RecordPullRequestInput
	readonly repoFullName: string
	readonly now: bigint
	readonly conflictUpdates: Record<string, SQL>
}) =>
	Effect.gen(function* () {
		const { input, repoFullName, now } = context
		const postgres = yield* PostgresDb
		const owner = input.owner ??
			(yield* findSessionForBranch({
				organizationId: input.organizationId,
				repoFullName,
				branch: input.row.headRef,
			})) ??
			(input.trailerSessionId
				? yield* findSessionInRepository({
						organizationId: input.organizationId,
						repoFullName,
						sessionId: input.trailerSessionId,
					})
				: null) ?? { sessionId: null, taskId: null, resourceOwnerUserId: null }
		const [record] = yield* postgres.query(
			postgres.client
				.insert(pullRequests)
				.values({
					organization_id: input.organizationId,
					task_id: owner.taskId,
					session_id: owner.sessionId,
					resource_owner_user_id: owner.resourceOwnerUserId,
					author_github_login: input.author?.login ?? null,
					author_github_id: input.author?.id ?? null,
					author_is_bot: input.author?.isBot ?? false,
					repo_full_name: repoFullName,
					number: input.row.number,
					url: input.row.url,
					title: input.row.title,
					state: input.row.state,
					is_draft: input.row.isDraft,
					head_ref: input.row.headRef,
					base_ref: input.row.baseRef || null,
					head_sha: input.row.headSha || null,
					mergeable: input.row.mergeable,
					review_decision: input.row.reviewDecision,
					unresolved_thread_count: input.row.unresolvedThreadCount,
					resolved_thread_count: input.row.resolvedThreadCount,
					changes_requested_reviews: input.row.changesRequestedReviews,
					merge_state: input.row.merge,
					opened_at: toEpochMs(input.timestamps?.openedAt),
					merged_at: toEpochMs(input.timestamps?.mergedAt),
					merged_by_github_login: input.timestamps?.mergedByLogin ?? null,
					closed_at: toEpochMs(input.timestamps?.closedAt),
					source: input.source,
					last_checked_at: now,
				})
				.onConflictDoUpdate({
					target: [pullRequests.organization_id, pullRequests.repo_full_name, pullRequests.number],
					set: {
						...filledOnce('task_id', 'session_id'),
						resource_owner_user_id: ownerOfLinkedSession,
						...fromReport('url', 'title', 'is_draft', 'head_ref', 'source'),
						...reportOrStored(
							'author_github_login',
							'author_github_id',
							'base_ref',
							'head_sha',
							'mergeable',
						),
						...context.conflictUpdates,
						author_is_bot: sql`case when ${excluded('author_github_login')} is null then ${pullRequests.author_is_bot} else ${excluded('author_is_bot')} end`,
						state: advancingState,
						last_checked_at: now,
						updated_at: now,
					},
				})
				.returning(),
		)
		if (!record) {
			return yield* Effect.fail(
				new GitHubIntegrationUnavailableError({ cause: 'pull_request_upsert_returned_nothing' }),
			)
		}
		const linked = yield* linkPullRequestSessions({
			organizationId: input.organizationId,
			repoFullName,
			branch: record.head_ref,
			headSha: record.head_sha,
			number: record.number,
		})
		const attributionMethod =
			pullRequestTierRank(linked.attributionMethod) > pullRequestTierRank(record.attribution_method)
				? linked.attributionMethod
				: record.attribution_method
		const hasOwner = record.session_id !== null || record.task_id !== null || attributionMethod !== null
		return { panelRow: toPanelPullRequest(record), attributionMethod, hasOwner }
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('record_pull_request', context.input.organizationId),
		),
	)

const branchMatches = (key: PullRequestBranchKey) =>
	and(eq(pullRequests.repo_full_name, key.repoFullName.toLowerCase()), eq(pullRequests.head_ref, key.branch))

/** Every record in the org on one of the branches, whatever session or task owns it, newest first. */
export const findPullRequestsForBranches = (input: {
	readonly organizationId: string
	readonly keys: readonly PullRequestBranchKey[]
}): Effect.Effect<readonly PullRequest[], GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		if (input.keys.length === 0) return []
		const postgres = yield* PostgresDb
		return yield* postgres.query(
			postgres.client
				.select()
				.from(pullRequests)
				.where(
					and(eq(pullRequests.organization_id, input.organizationId), or(...input.keys.map(branchMatches))),
				)
				.orderBy(desc(pullRequests.updated_at)),
		)
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('find_pull_requests_for_branches', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.find_for_branches', {
			attributes: { organization_id: input.organizationId, branch_count: input.keys.length },
		}),
	)

/** The records a session or a task owns, newest first: the branches recorded before any observation. */
export const findLinkedPullRequests = (input: {
	readonly organizationId: string
	readonly owner: { readonly sessionId: string } | { readonly taskId: string }
}): Effect.Effect<readonly PullRequest[], GitHubIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const postgres = yield* PostgresDb
		const ownedBy =
			'sessionId' in input.owner
				? eq(pullRequests.session_id, input.owner.sessionId)
				: eq(pullRequests.task_id, input.owner.taskId)
		return yield* postgres.query(
			postgres.client
				.select()
				.from(pullRequests)
				.where(and(eq(pullRequests.organization_id, input.organizationId), ownedBy))
				.orderBy(desc(pullRequests.updated_at)),
		)
	}).pipe(
		Effect.catchTag(
			'PostgresDbQueryError',
			capturePullRequestFailure('find_linked_pull_requests', input.organizationId),
		),
		Effect.withSpan('github.pull_requests.find_linked', {
			attributes: { organization_id: input.organizationId },
		}),
	)

const recordsOnBranch = (records: ReadonlyArray<PullRequest>, key: PullRequestBranchKey): PullRequest[] => {
	const repoFullName = key.repoFullName.toLowerCase()
	return records.filter((record) => record.repo_full_name === repoFullName && record.head_ref === key.branch)
}

/** The newest open pull request on the branch, else the newest of any state. */
export const selectPullRequestForBranch = (
	records: ReadonlyArray<PullRequest>,
	key: PullRequestBranchKey,
): PullRequest | null => {
	const onBranch = recordsOnBranch(records, key)
	return onBranch.find((record) => record.state === 'open') ?? onBranch[0] ?? null
}

/** Every other pull request recorded on the branch, highest number first. */
export const selectEarlierPullRequestsForBranch = (
	records: ReadonlyArray<PullRequest>,
	key: PullRequestBranchKey,
	selected: PullRequest | null,
): PullRequest[] =>
	recordsOnBranch(records, key)
		.filter((record) => record.number !== selected?.number)
		.toSorted((left, right) => right.number - left.number)
