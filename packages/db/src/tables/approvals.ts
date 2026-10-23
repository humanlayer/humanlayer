import { sql } from 'drizzle-orm'
import { bigint, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import type { PermissionUpdate } from '../zodschemas/permission-update'
import { sessions } from './sessions'
import { tasks } from './tasks'

export const approvals = pgTable(
	'approvals',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),

		session_id: uuid()
			.notNull()
			.references(() => sessions.id, { onDelete: 'cascade' }),

		// Organization ID for Electric SQL filtering
		organization_id: uuid().notNull(),

		// User ID for Electric SQL filtering (renamed from userId)
		user_id: text().notNull(),

		// Host ID for daemon-specific filtering
		host_id: uuid().notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),

		task_id: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),

		tool_use_id: text(),

		status: text().notNull().$type<'pending' | 'approved' | 'denied'>().default('pending'),

		// User ID of the person who approved/denied this approval (null while pending)
		approved_by_user_id: text('approved_by_user_id'),

		responded_at: bigint('responded_at', { mode: 'bigint' }),
		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),

		tool_name: text(),

		tool_input: jsonb(),

		// Optional agent ID for subagent tracking
		agent_id: text(),

		// Suggestions from the SDK (PermissionUpdate[] in practice; legacy rows may be stringified JSON)
		suggestions: jsonb().$type<PermissionUpdate[]>(),

		// Subset of `suggestions` the user chose to apply when resolving (null on deny / no selection)
		applied_suggestions: jsonb().$type<PermissionUpdate[]>(),

		comment: text(),
	},
	(t) => [
		index('approvals_org_owner_idx').on(t.organization_id, t.resource_owner_user_id),
		index('approvals_org_task_idx').on(t.organization_id, t.task_id),
		index('approvals_session_id_idx').on(t.session_id),
	],
)

export const approvalSelectSchema = createSelectSchema(approvals)
export const approvalInsertSchema = createInsertSchema(approvals)
export const approvalUpdateSchema = createUpdateSchema(approvals)
export type Approval = typeof approvals.$inferSelect
export type NewApproval = typeof approvals.$inferInsert
