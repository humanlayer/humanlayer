import { sql } from 'drizzle-orm'
import { bigint, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'

import { organizations } from './organizations'

/**
 * Per-(host, repo) resume watermark for the daemon's commit HEAD-watch. Holds the
 * last commit sha already recorded to the ledger. The watcher advances it ONLY
 * after a successful record, so on restart the catch-up scan re-derives commits
 * from `last_seen_sha`..HEAD (idempotent on the ledger's (org, sha)). No local
 * SQLite — Postgres is the sole store, watermark included.
 */
export const commitWatchWatermarks = pgTable(
	'commit_watch_watermarks',
	{
		host_id: text().notNull(),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		// Local repo root path; disambiguates multi-repo / no-remote workspaces.
		repo_directory: text().notNull(),
		// Last sha already recorded for this repo; null until the first scan lands.
		last_seen_sha: text(),
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),
	},
	(t) => [
		unique('commit_watch_watermarks_unique').on(t.host_id, t.organization_id, t.repo_directory),
		index('commit_watch_watermarks_org_host_idx').on(t.organization_id, t.host_id),
	],
)

export const commitWatchWatermarkSelectSchema = createSelectSchema(commitWatchWatermarks)
export const commitWatchWatermarkInsertSchema = createInsertSchema(commitWatchWatermarks)
export const commitWatchWatermarkUpdateSchema = createUpdateSchema(commitWatchWatermarks)
export type CommitWatchWatermark = typeof commitWatchWatermarks.$inferSelect
export type NewCommitWatchWatermark = typeof commitWatchWatermarks.$inferInsert
