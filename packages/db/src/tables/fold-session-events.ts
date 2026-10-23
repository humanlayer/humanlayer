import { sql } from 'drizzle-orm'
import { bigint, check, integer, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core'

import { sessions } from './sessions'

export interface FoldSessionEventPayload {
	readonly seq: number
	readonly eventId: string
	readonly ts: number
	readonly version: number
	readonly [key: string]: unknown
}

export const foldSessionEvents = pgTable(
	'fold_session_events',
	{
		session_id: uuid()
			.references(() => sessions.id, { onDelete: 'cascade' })
			.notNull(),
		seq: integer().notNull(),
		event_id: text().notNull(),
		ts: bigint({ mode: 'number' }).notNull(),
		event: jsonb().$type<FoldSessionEventPayload>().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.session_id, table.seq] }),
		unique('fold_session_events_session_id_event_id_unique').on(table.session_id, table.event_id),
		check(
			'fold_session_events_relational_envelope_check',
			sql`${table.event} @> jsonb_build_object('seq', ${table.seq}, 'eventId', ${table.event_id}, 'ts', ${table.ts})`,
		),
	],
)

export type FoldSessionEvent = typeof foldSessionEvents.$inferSelect
