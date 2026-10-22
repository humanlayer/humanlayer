import type {
	WorkspaceSetupError,
	WorkspaceSetupStage,
	WorkspaceSetupState,
	WorkspaceSpec,
} from '@humanlayer/schemas/effect/workspace'
import {
	WorkspaceSetupErrorSchema,
	WorkspaceSetupStageSchema,
	WorkspaceSetupStateSchema,
	WorkspaceSpecSchema,
} from '@humanlayer/schemas/zod/workspace'
import { sql } from 'drizzle-orm'
import { bigint, check, foreignKey, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'

import { jsonbParser } from '../utils/jsonb-parser'
import { organizations } from './organizations'
import { tasks } from './tasks'

export type WorkspaceSetupStatus = WorkspaceSetupStage

export const taskWorkspaceSetupForHost = pgTable(
	'task_workspace_setup_for_host',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		task_id: uuid('task_id')
			.references(() => tasks.id, { onDelete: 'cascade' })
			.notNull(),
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		host_id: text('host_id').notNull(),
		status: text('status').$type<WorkspaceSetupStatus>().default('setup_requested').notNull(),
		resolved_workspace_spec: jsonb('resolved_workspace_spec').$type<WorkspaceSpec>(),
		workspace_setup_state: jsonb('workspace_setup_state').$type<WorkspaceSetupState>().notNull(),
		error: jsonb('error').$type<WorkspaceSetupError>(),
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
		// Used by workspace setup upserts; keep this exact key for onConflict target parity.
		unique('task_workspace_setup_for_host_unique').on(t.organization_id, t.task_id, t.host_id),
		foreignKey({
			name: 'task_workspace_setup_for_host_org_task_fk',
			columns: [t.organization_id, t.task_id],
			foreignColumns: [tasks.organization_id, tasks.id],
		}).onDelete('cascade'),
		// Mirrors WorkspaceSetupStageSchema so invalid JSON/status combinations fail before readers parse JSONB.
		check(
			'task_workspace_setup_for_host_status_check',
			sql`${t.status} in ('setup_requested', 'preflight', 'worktree', 'copy_globs', 'setup_command', 'done')`,
		),
		// Daemon sync filters by organization_id + host_id; unique(org, task, host) does not cover this order.
		index('task_workspace_setup_for_host_org_host_idx').on(t.organization_id, t.host_id),
	],
)

export const taskWorkspaceSetupForHostSelectSchema = createSelectSchema(taskWorkspaceSetupForHost, {
	status: WorkspaceSetupStageSchema,
	resolved_workspace_spec: jsonbParser(WorkspaceSpecSchema.nullable()),
	workspace_setup_state: jsonbParser(WorkspaceSetupStateSchema),
	error: jsonbParser(WorkspaceSetupErrorSchema.nullable()),
})
export const taskWorkspaceSetupForHostInsertSchema = createInsertSchema(taskWorkspaceSetupForHost, {
	status: WorkspaceSetupStageSchema.optional(),
	resolved_workspace_spec: WorkspaceSpecSchema.nullish(),
	workspace_setup_state: WorkspaceSetupStateSchema,
	error: WorkspaceSetupErrorSchema.nullish(),
})
export const taskWorkspaceSetupForHostUpdateSchema = createUpdateSchema(taskWorkspaceSetupForHost, {
	status: WorkspaceSetupStageSchema.optional(),
	resolved_workspace_spec: WorkspaceSpecSchema.nullish(),
	workspace_setup_state: WorkspaceSetupStateSchema.optional(),
	error: WorkspaceSetupErrorSchema.nullish(),
})
export type TaskWorkspaceSetupForHost = typeof taskWorkspaceSetupForHost.$inferSelect
export type NewTaskWorkspaceSetupForHost = typeof taskWorkspaceSetupForHost.$inferInsert
