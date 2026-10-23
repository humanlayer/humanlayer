import { sql } from 'drizzle-orm'
import { bigint, boolean, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { organizations } from './organizations'
import { sessions } from './sessions'
import { tasks } from './tasks'

/**
 * Repositories a live session works in, as the daemon observes them on the host:
 * repo root, `origin` remote and the branch HEAD points at. The link between a
 * session and a pull request goes through these rows, so a session with no task
 * and an agent-created branch are both covered.
 */
export const sessionRepositories = pgTable(
	'session_repositories',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		session_id: uuid()
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),
		/** Copied from the session at write time so task-scoped reads hit one index. */
		task_id: uuid().references(() => tasks.id, { onDelete: 'set null' }),

		/** The daemon host that observed the checkout. */
		host_id: text('host_id').notNull(),
		/** Absolute repository root on that host (`git rev-parse --show-toplevel`). */
		local_path: text('local_path').notNull(),
		/** `origin` url as git reports it; null when the repository has no remote. */
		remote_url: text('remote_url'),
		/** Lowercased "owner/repo" parsed server-side from remote_url; null when not github.com. */
		repo_full_name: text('repo_full_name'),
		/** Branch HEAD points at; null when HEAD is detached. */
		branch: text('branch'),
		/** True for the branch HEAD points at now for (session, local_path); false for every other branch row of that pair. */
		is_head: boolean('is_head').notNull().default(true),

		first_seen_at: bigint('first_seen_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		last_seen_at: bigint('last_seen_at', { mode: 'bigint' })
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
		// Upsert anchor for the daemon's snapshot report. NULLS NOT DISTINCT so a
		// detached-HEAD row (branch is null) is unique for its (session, path) too.
		unique('session_repositories_session_path_branch_key')
			.on(t.organization_id, t.session_id, t.local_path, t.branch)
			.nullsNotDistinct(),
		// Webhook link: (org, repo, branch) -> newest session that observed the branch.
		index('session_repositories_org_repo_branch_idx').on(t.organization_id, t.repo_full_name, t.branch),
		// Task-scoped target list (every session of a task).
		index('session_repositories_org_task_idx').on(t.organization_id, t.task_id),
		// FK support for session_id's ON DELETE CASCADE: the referential action looks
		// up by session_id alone, which the org-leftmost unique constraint cannot serve.
		index('session_repositories_session_id_idx').on(t.session_id),
	],
)

export const sessionRepositorySelectSchema = createSelectSchema(sessionRepositories)
export const sessionRepositoryInsertSchema = createInsertSchema(sessionRepositories)
export const sessionRepositoryUpdateSchema = createUpdateSchema(sessionRepositories)
export type SessionRepository = typeof sessionRepositories.$inferSelect
export type NewSessionRepository = typeof sessionRepositories.$inferInsert
