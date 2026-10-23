import { sql } from 'drizzle-orm'
import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { type PullRequestAttributionMethod } from './pull-requests'
import { sessions } from './sessions'
import { tasks } from './tasks'

/**
 * Every session tied to a pull request, one row per (pull request, session), with how strongly.
 * Written whenever the pull request is recorded, never derived later: branch names are reused,
 * so a join at read time would credit whoever holds the name now.
 */
export const pullRequestSessions = pgTable(
	'pull_request_sessions',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		/** Lowercased "owner/repo"; with `number` this is the pull request's natural key. */
		repo_full_name: text('repo_full_name').notNull(),
		number: integer('number').notNull(),
		session_id: uuid()
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),
		/** Copied from the session at link time so task-scoped reads hit one index. */
		task_id: uuid().references(() => tasks.id, { onDelete: 'set null' }),
		/** The session's resource owner at link time. */
		user_id: text('user_id'),
		/** Strongest tier seen for this session; only ever advances. */
		tier: text('tier').$type<PullRequestAttributionMethod>().notNull(),
		linked_at: bigint('linked_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

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
		uniqueIndex('pull_request_sessions_org_repo_number_session_idx').on(
			t.organization_id,
			t.repo_full_name,
			t.number,
			t.session_id,
		),
		// A task's or a session's pull requests: (org, task) hits the prefix, (org, session)
		// reaches session_id via skip scan. Same shape as pull_requests_org_task_session_idx.
		index('pull_request_sessions_org_task_session_idx').on(t.organization_id, t.task_id, t.session_id),
		// FK support for session_id's ON DELETE CASCADE: the referential action looks up by
		// session_id alone.
		index('pull_request_sessions_session_id_idx').on(t.session_id),
	],
)

export const pullRequestSessionSelectSchema = createSelectSchema(pullRequestSessions)
export const pullRequestSessionInsertSchema = createInsertSchema(pullRequestSessions)
export const pullRequestSessionUpdateSchema = createUpdateSchema(pullRequestSessions)
export type PullRequestSession = typeof pullRequestSessions.$inferSelect
export type NewPullRequestSession = typeof pullRequestSessions.$inferInsert
