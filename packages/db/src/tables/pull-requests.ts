import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

/** Mirrors `PullRequestStateSchema` in @humanlayer/riptide-api-contract (db cannot depend on contracts). */
export const pullRequestStateSchema = z.enum(['open', 'closed', 'merged'])
export type PullRequestState = z.infer<typeof pullRequestStateSchema>

/**
 * `app`: read through the GitHub App by the panel query; `webhook`: pushed by a delivery. `daemon`
 * and `backfill` name rows older writers left behind.
 */
export const pullRequestSourceSchema = z.enum(['daemon', 'webhook', 'app', 'backfill'])
export type PullRequestSource = z.infer<typeof pullRequestSourceSchema>

/**
 * How strongly a HumanLayer session is tied to the pull request, weakest to strongest. `observed`:
 * a session had the head branch checked out. `committed`: a session's commit is on the branch.
 * Only `committed` counts in metrics; null is a pull request no session touched.
 */
export const pullRequestAttributionMethodSchema = z.enum(['observed', 'committed'])
export type PullRequestAttributionMethod = z.infer<typeof pullRequestAttributionMethodSchema>

export const pullRequestReviewDecisionSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])
export type PullRequestReviewDecision = z.infer<typeof pullRequestReviewDecisionSchema>

/** Mirrors `ChangesRequestedReview` in @humanlayer/streams/pr-status (db cannot depend on streams). */
export const pullRequestChangesRequestedReviewSchema = z.object({
	login: z.string().nullable(),
	body: z.string(),
	submittedAt: z.string().nullable(),
	url: z.string().nullable(),
})
export type PullRequestChangesRequestedReview = z.infer<typeof pullRequestChangesRequestedReviewSchema>
export const pullRequestMergeMethodSchema = z.enum(['MERGE', 'SQUASH', 'REBASE'])
export type PullRequestMergeMethod = z.infer<typeof pullRequestMergeMethodSchema>

/** Mirrors `PullRequestMergeState` in @humanlayer/streams/pr-status (db cannot depend on streams). */
export const pullRequestMergeStateSchema = z.object({
	mergeStateStatus: z.enum(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']),
	autoMergeRequest: z
		.object({
			enabledBy: z.object({ login: z.string() }).nullable(),
			mergeMethod: pullRequestMergeMethodSchema,
		})
		.nullable(),
	viewerCanEnableAutoMerge: z.boolean(),
	viewerCanDisableAutoMerge: z.boolean(),
	viewerCanUpdateBranch: z.boolean(),
	mergeHeadline: z.string(),
	mergeBody: z.string(),
	squashHeadline: z.string(),
	squashBody: z.string(),
	commitCount: z.number().int(),
	mergeCommitAllowed: z.boolean(),
	squashMergeAllowed: z.boolean(),
	rebaseMergeAllowed: z.boolean(),
	viewerDefaultMergeMethod: pullRequestMergeMethodSchema,
})
export type PullRequestMergeState = z.infer<typeof pullRequestMergeStateSchema>

export const pullRequests = pgTable(
	'pull_requests',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		// Attribution: the session/task/user whose agent produced this pull request. Filled once
		// from the strongest link at the time; every linked session is in pull_request_sessions.
		task_id: uuid().references(() => tasks.id, { onDelete: 'set null' }),
		session_id: uuid().references(() => sessions.id, { onDelete: 'set null' }),
		/** WorkOS user credited (session.resource_owner_user_id at link time); null when no session is linked. */
		resource_owner_user_id: text('resource_owner_user_id'),
		attribution_method: text('attribution_method').$type<PullRequestAttributionMethod>(),

		// GitHub identity of the PR (author credit — industry standard, NOT merged_by)
		author_github_login: text('author_github_login'),
		/** GitHub numeric user id as text, stable across renames; null when the writer only knew the login. */
		author_github_id: text('author_github_id'),
		/**
		 * GitHub's authoritative account type when the report carries it (GraphQL `__typename: Bot`);
		 * falls back to the reserved `[bot]` login suffix. True only for GitHub App bots — org-specific
		 * machine users are indistinguishable at capture time and are a query-layer concern.
		 */
		author_is_bot: boolean('author_is_bot').notNull().default(false),

		// PR identity — org-scoped natural key (two orgs may track the same public repo)
		repo_full_name: text('repo_full_name').notNull(), // "owner/repo", lowercased server-side
		number: integer('number').notNull(),
		github_node_id: text('github_node_id'),

		url: text('url').notNull(),
		title: text('title').notNull(),
		state: text('state').$type<PullRequestState>().notNull(),
		is_draft: boolean('is_draft').notNull().default(false),
		head_ref: text('head_ref').notNull(), // joins session_repositories and commits via repo_full_name + branch
		base_ref: text('base_ref'),
		head_sha: text('head_sha'),
		mergeable: boolean('mergeable'),
		review_decision: text('review_decision').$type<PullRequestReviewDecision>(),
		/** Review threads as the panel query last counted them; null until it has. */
		unresolved_thread_count: integer('unresolved_thread_count'),
		resolved_thread_count: integer('resolved_thread_count'),
		/** Reviewers whose latest review requested changes with a body, newest first; null until read. */
		changes_requested_reviews: jsonb('changes_requested_reviews').$type<PullRequestChangesRequestedReview[]>(),
		/** How GitHub judged the merge when the panel query last asked; null until it has. */
		merge_state: jsonb('merge_state').$type<PullRequestMergeState>(),

		opened_at: bigint('opened_at', { mode: 'bigint' }),
		merged_at: bigint('merged_at', { mode: 'bigint' }),
		merged_by_github_login: text('merged_by_github_login'),
		closed_at: bigint('closed_at', { mode: 'bigint' }),

		source: text('source').$type<PullRequestSource>().notNull().default('daemon'),
		capture_version: integer('capture_version').notNull().default(1),
		/** Last time any source confirmed state with GitHub. */
		last_checked_at: bigint('last_checked_at', { mode: 'bigint' }),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		// Org-scoped natural key: the idempotency anchor for every writer.
		uniqueIndex('pull_requests_org_repo_number_idx').on(t.organization_id, t.repo_full_name, t.number),
		// Per-user PR reads and merged-over-time windows. One index serves both:
		// (org, owner) hits the prefix, and (org, merged_at) ranges reach merged_at
		// via PG18 b-tree skip scan over the low-cardinality per-org owner column.
		// Same consolidation shape as commits_org_owner_committed_idx.
		index('pull_requests_org_owner_merged_idx').on(t.organization_id, t.resource_owner_user_id, t.merged_at),
		// Task/session-scoped reads (a task's PR panel, a session's PR drill-down).
		// (org, task) hits the prefix; (org, session) reaches session_id via skip
		// scan. Same shape as commits_org_task_session_idx.
		index('pull_requests_org_task_session_idx').on(t.organization_id, t.task_id, t.session_id),
		// FK support for session_id's ON DELETE SET NULL: referential actions look up
		// by session_id ALONE (no org/task), which the combined index above can't
		// serve — skip scan over the high-cardinality task_id prefix degrades to a
		// full index scan. Same pattern as commits_session_id_idx.
		index('pull_requests_session_id_idx').on(t.session_id),
	],
)

export const pullRequestSelectSchema = createSelectSchema(pullRequests)
export const pullRequestInsertSchema = createInsertSchema(pullRequests)
export const pullRequestUpdateSchema = createUpdateSchema(pullRequests)
export type PullRequest = typeof pullRequests.$inferSelect
export type NewPullRequest = typeof pullRequests.$inferInsert
