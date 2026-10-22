import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import z from 'zod/v4'

import {
	type AccessRequestInitialEmailAttempts,
	AccessRequestInitialEmailAttemptsSchema,
	type AccessRequestScheduledReminders,
	AccessRequestScheduledRemindersSchema,
} from '../zodschemas/access-request-email-metadata'
import { artifacts } from './artifacts'
import { organizations } from './organizations'

export const accessRequestStatus = pgEnum('access_request_status', ['pending', 'invited', 'archived'])
export const accessRequestNotificationStatus = pgEnum('access_request_notification_status', [
	'not_started',
	'scheduled',
	'partial',
	'failed',
	'canceled',
])

export const accessRequests = pgTable(
	'access_requests',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		organization_id: uuid('organization_id')
			.notNull()
			.references(() => organizations.id, { onDelete: 'cascade' }),
		artifact_id: uuid('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
		artifact_title_snapshot: text('artifact_title_snapshot').notNull(),
		artifact_owner_user_id: text('artifact_owner_user_id').notNull(),
		requester_user_id: text('requester_user_id'),
		requester_email: text('requester_email').notNull(),
		status: accessRequestStatus('status').notNull().default('pending'),
		request_generation: integer('request_generation').notNull().default(1),
		requested_at: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
		reminder_scheduled_at: timestamp('reminder_scheduled_at', { withTimezone: true }),
		resolved_at: timestamp('resolved_at', { withTimezone: true }),
		archived_at: timestamp('archived_at', { withTimezone: true }),
		notification_status: accessRequestNotificationStatus('notification_status').notNull().default('not_started'),
		initial_email_attempts: jsonb('initial_email_attempts')
			.$type<AccessRequestInitialEmailAttempts>()
			.notNull()
			.default([]),
		scheduled_reminders: jsonb('scheduled_reminders')
			.$type<AccessRequestScheduledReminders>()
			.notNull()
			.default([]),
		resolved_by_user_id: text('resolved_by_user_id'),
		created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex('access_requests_artifact_email_idx').on(t.artifact_id, t.requester_email),
		index('access_requests_org_idx').on(t.organization_id),
	],
)

const jsonbParser = <T extends z.ZodTypeAny>(schema: T) =>
	z.preprocess((val) => {
		if (typeof val === 'string') {
			try {
				return JSON.parse(val)
			} catch {
				return val
			}
		}
		return val
	}, schema)

const accessRequestJsonbSchemas = {
	initial_email_attempts: jsonbParser(AccessRequestInitialEmailAttemptsSchema),
	scheduled_reminders: jsonbParser(AccessRequestScheduledRemindersSchema),
}

export const accessRequestSelectSchema = createSelectSchema(accessRequests, accessRequestJsonbSchemas)
export const accessRequestInsertSchema = createInsertSchema(accessRequests, accessRequestJsonbSchemas)
export const accessRequestUpdateSchema = createUpdateSchema(accessRequests, accessRequestJsonbSchemas)

export type AccessRequest = typeof accessRequests.$inferSelect
export type NewAccessRequest = typeof accessRequests.$inferInsert
export type AccessRequestStatus = (typeof accessRequestStatus.enumValues)[number]
