import { type CodingAgent, CodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	doublePrecision,
	index,
	integer,
	jsonb,
	pgTable,
	pgView,
	text,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

/**
 * Per-file numstat entry. Binary files carry binary: true with 0/0 counts.
 * changeId (v3+; camelCase — jsonb keys pass through from the daemon contract
 * unmapped): content-derived id of this file's diff — sha256 over the file's
 * added/deleted line hashes, sha-independent. A squash commit touching a file that
 * exactly one branch commit touched carries the SAME per-file changeId as that
 * branch commit, which is what lets read paths dedup squash re-landings (a
 * commit-level id can't: a squash diff is the union of several diffs).
 */
export const CommitFileStatSchema = z.object({
	path: z.string(),
	additions: z.number().int(),
	deletions: z.number().int(),
	binary: z.boolean().optional(),
	changeId: z.string().optional(),
})
export type CommitFileStat = z.infer<typeof CommitFileStatSchema>

/**
 * The commit ledger. Every commit the daemon's HEAD-watch observes in a watched
 * repo (agent OR human) gets a row — metadata only, numstat, never diffs. Each
 * row carries an attribution tier set daemon-side: 'confirmed' (session trailer),
 * 'inferred' (line-match against the session's agent edits) or 'human' (no match).
 * Insert-only, idempotent on (org, sha); amend/rebase yields a new sha (new row)
 * and orphans are kept — a commit is a commit. capture_algorithm_version /
 * attribution_algorithm_version are the hedge to re-derive or tighten later.
 */
export const commits = pgTable(
	'commits',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		// Attribution (denormalized at insert, same as conversation_events)
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		// The session this commit is ATTRIBUTED to (confirmed/inferred). Null for a
		// 'human' commit — a human-made commit with no matching agent session. Set
		// null (not cascade) so deleting a session never removes shipped ledger rows.
		session_id: uuid().references(() => sessions.id, { onDelete: 'set null' }),
		task_id: uuid().references(() => tasks.id, { onDelete: 'set null' }),
		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		// Git identity
		commit_sha: text().notNull(),
		parent_shas: jsonb().$type<string[]>(), // merge detection (len > 1); future graph reconciliation
		branch: text(), // null when detached HEAD — see JOIN CAVEAT below
		repo_remote_url: text(), // best-effort, null when no remote
		repo_full_name: text(), // parsed "owner/repo", null when unparseable
		repo_directory: text(), // local repo root; disambiguates no-remote/multi-repo

		// Content (user-requested; same sensitivity class as conversation events)
		subject: text().notNull(), // first line, truncated to 512 chars
		body: text(), // rest of message, truncated to 10_000 chars

		// Git authorship (distinguishes git identity from RIPTIDE identity; rebase forensics)
		author_name: text(),
		author_email: text(),
		authored_at: bigint('authored_at', { mode: 'bigint' }),
		committed_at: bigint('committed_at', { mode: 'bigint' }).notNull(), // metrics time axis

		// Stats (numstat only)
		additions: integer().notNull().default(0),
		deletions: integer().notNull().default(0),
		files_changed: integer().notNull().default(0), // always the true count
		// Per-file numstat; null when the commit recorded no files. A MERGE is always null
		// from capture_algorithm_version 3 on (its content belongs to the branch it brings
		// in, not to the merger). Rows captured under v2 cannot be trusted: a v2 merge
		// carries the whole first-parent diff, so `additions` there is the entire incoming
		// branch. Metrics never see either case — they read the `authoredCommits` view
		// below, which excludes merge rows.
		file_stats: jsonb().$type<CommitFileStat[]>(),

		// Provenance
		co_authored_by_agent: boolean().notNull().default(false), // "Co-Authored-By: Claude" trailer heuristic
		coding_agent: text().$type<CodingAgent>(), // from session; metrics avoid a join
		capture_algorithm_version: integer().notNull(), // Cursor lesson: version the algorithm

		// Content identity + capture context (v3+; null on older rows). All three follow
		// Cursor's shipped commit-scoring model, verified against their 3.16.29 build.
		//
		// change_id: deterministic content-derived id — sha256 over the commit's per-file
		// change ids (each from the file's added/deleted line hashes). No sha, no timestamp,
		// so the SAME work re-landing under a NEW sha (rebase merge, cherry-pick, amend then
		// re-land) carries the SAME change_id, giving read paths a dedup key the sha-unique
		// ledger cannot: measured on the landing-methods diagnostic, sha-keyed capture counts
		// squash/rebase/cherry-pick landings 2.0x. Squash dedup needs the PER-FILE ids in
		// file_stats (see CommitFileStatSchema) — a squash diff is a union, so the
		// commit-level id intentionally won't match. Null: merge commit (no diff under
		// --diff-merges=off), no textual changes, or capture < v3.
		change_id: text(),
		// Was HEAD on the repo's default branch (origin/HEAD) when captured? Null = unknown:
		// detached HEAD, or no origin/HEAD to name a default (never guessed from branch
		// names). Capture-time truth, like Cursor's isPrimaryBranch — a branch commit does
		// NOT flip to true when later merged (sha-idempotency keeps the original row).
		// Filter to primary-only ONLY under squash/rebase landing, where main gets fresh
		// shas; under merge-commit landing the work's rows stay branch-stamped.
		is_primary_branch: boolean(),
		// Does the commit's author email match the capturing daemon's git user.email?
		// Cursor refuses to score unowned commits at all; the ledger keeps them (denominator)
		// but stamps the mismatch, because resource_owner_user_id is WHO OBSERVED, not who
		// authored — on dev, 63,869 additions of one user's commits sat under another user's
		// id. Per-user metrics must require author_matches_daemon_user = true. Null: either
		// email unavailable, or capture < v3.
		author_matches_daemon_user: boolean(),

		// Attribution tier (daemon-side). Nullable: legacy rows predate attribution.
		attribution_method: text().$type<'confirmed' | 'inferred' | 'human'>(),
		ai_confidence: doublePrecision(), // 1.0 confirmed · match-fraction inferred · 0.0 human
		ai_attributed_lines: integer(), // matched added lines; `additions` stays the total
		attribution_algorithm_version: integer(), // matcher versioned independently of capture

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		// No updated_at: rows are insert-only (onConflictDoNothing, no reconciliation in v1).
	},
	(t) => [
		uniqueIndex('commits_org_sha_idx').on(t.organization_id, t.commit_sha), // idempotency anchor
		// Per-user commit timelines: the metrics read path (commits over time for a user/org).
		index('commits_org_owner_committed_idx').on(t.organization_id, t.resource_owner_user_id, t.committed_at),
		// Task/session-scoped reads (a task's commit panel, a session's commit drill-down).
		// One index serves both: (org, task) hits the prefix, and (org, session) reaches
		// session_id via PG18 b-tree skip scan. Same shape as
		// conversation_events_org_task_session_idx.
		index('commits_org_task_session_idx').on(t.organization_id, t.task_id, t.session_id),
		// FK support for session_id's ON DELETE SET NULL: referential actions look up by
		// session_id ALONE (no org/task), which the combined index above can't serve —
		// skip scan over the high-cardinality task_id prefix degrades to a full index
		// scan. Same pattern as conversation_events_session_id_idx.
		index('commits_session_id_idx').on(t.session_id),
	],
)

/**
 * The commit ledger minus merge commits — the population every metric reads.
 *
 * A merge is integration, not authored output, so it belongs in neither LOC
 * sums nor commit counts. It ALSO cannot be counted safely: rows captured
 * before capture_algorithm_version 3 record the merge's FIRST-PARENT diff
 * (`git show --numstat` silently falls back to it), crediting the merger with
 * the entire incoming branch — on the dev org that was 83% of all reported
 * agent LOC and inverted the per-user ranking (PR #2221). v3+ captures merges
 * with zero numstat, and old daemons keep writing pre-v3 rows until they
 * update, so reading through this view is what keeps metrics right on every
 * capture version, past and future.
 *
 * Query THIS view for any counting/aggregation; query `commits` directly only
 * when merges genuinely belong in the answer (session drill-downs, graph
 * forensics). Note: the view snapshots the ledger's columns — after adding a
 * column to `commits`, regenerate migrations so the view is recreated.
 */
export const authoredCommits = pgView('authored_commits').as((qb) =>
	qb
		.select()
		.from(commits)
		.where(sql`COALESCE(jsonb_array_length(${commits.parent_shas}), 1) = 1`),
)

export const commitSelectSchema = createSelectSchema(commits, {
	coding_agent: CodingAgentZodSchema.nullable(),
	parent_shas: jsonbParser(z.array(z.string()).nullable()),
	file_stats: jsonbParser(z.array(CommitFileStatSchema).nullable()),
})
export const commitInsertSchema = createInsertSchema(commits, {
	coding_agent: CodingAgentZodSchema.nullish(),
	parent_shas: z.array(z.string()).nullish(),
	file_stats: z.array(CommitFileStatSchema).nullish(),
})
export const commitUpdateSchema = createUpdateSchema(commits, {
	coding_agent: CodingAgentZodSchema.nullish(),
	parent_shas: z.array(z.string()).nullish(),
	file_stats: z.array(CommitFileStatSchema).nullish(),
})
export type Commit = typeof commits.$inferSelect
export type NewCommit = typeof commits.$inferInsert
