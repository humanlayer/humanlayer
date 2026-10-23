import {
	TASK_WORKFLOW_TYPES,
	type TaskWorkflowType,
	WORKTREE_TIMINGS,
	type WorktreeTiming,
} from '@humanlayer/schemas/effect/taskconfiguration'
import type { WorkspaceSpec, WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { WorkspaceSpecSchema, WorkspaceStateSchema } from '@humanlayer/schemas/zod/workspace'
import { sql } from 'drizzle-orm'
import { bigint, boolean, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import { uuidv7 } from 'uuidv7'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import {
	type CreatedWithExperimentFlags,
	CreatedWithExperimentFlagsSchema,
} from '../zodschemas/created-with-experiment-flags'
import { organizations } from './organizations'
import { projects } from './projects'
import { teams } from './teams'
import { workspaces } from './workspaces'

// Setup status type for bootstrap progress tracking
export type SetupStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
export type TicketProvider = 'linear' | 'jira' | 'github'
export const tasks = pgTable(
	'tasks',
	{
		id: uuid()
			.primaryKey()
			.default(sql`uuidv7()`)
			.$defaultFn(() => uuidv7()),
		team_id: uuid().references(() => teams.id, { onDelete: 'cascade' }),
		project_id: uuid().references(() => projects.id, { onDelete: 'cascade' }),
		workspace_id: uuid().references(() => workspaces.id, { onDelete: 'cascade' }),
		organization_id: uuid()
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),

		created_at: bigint('created_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now())),

		created_by: text('created_by').notNull(),

		resource_owner_user_id: text('resource_owner_user_id').notNull(),
		/**
		 * Track the time the session was last updated
		 */
		updated_at: bigint('updated_at', { mode: 'bigint' })
			.notNull()
			.default(sql`(extract(epoch from now()) * 1000)::bigint`)
			.$defaultFn(() => BigInt(Date.now()))
			.$onUpdateFn(() => BigInt(Date.now())),

		name: text().notNull(),
		slug: text(),
		default_working_directory: text(),
		external_task_id: text(),
		archived: boolean('archived').default(false).notNull(),

		// Draft flag - true for saved but not launched tasks
		is_draft: boolean('is_draft').default(false).notNull(),

		// Setup state columns for deterministic task bootstrap
		setup_status: text().$type<SetupStatus>(),
		setup_details: text(), // Error message or status info
		ticket_id: text(), // Linear ticket ID, e.g. "ENG-123"
		ticket_url: text(), // Linear ticket URL, e.g. "https://linear.app/humanlayer/issue/ENG-123/..."
		ticket_description: text(), // Manual task description
		ticket_provider: text('ticket_provider').$type<TicketProvider>(), // Ticket provider, e.g. "linear", "jira", or "github"
		github_connection_id: uuid('github_connection_id'), // Canonical GitHub connection identity
		ticket_repository_id: text('ticket_repository_id'), // Stable provider repository ID for GitHub tickets
		ticket_repository_full_name: text('ticket_repository_full_name'), // owner/repository snapshot for display

		/**
		 * Immutable JSON snapshot of the experiment flags that shaped this task's
		 * creation.
		 */
		created_with_experiment_flags: jsonb('created_with_experiment_flags').$type<CreatedWithExperimentFlags>(),

		// Auto-advance workflow flags
		workflow_type: text('workflow_type').$type<TaskWorkflowType>().default('rpi').notNull(),
		worktree_timing: text('worktree_timing').$type<WorktreeTiming>().default('later').notNull(),
		/** @deprecated Prefer workspace_spec plus the current host setup row for setup-aware reads. */
		workspace_state: jsonb().$type<WorkspaceState>(),
		/** Host-independent desired workspace shape. Host-specific facts live in task_workspace_setup_for_host. */
		workspace_spec: jsonb().$type<WorkspaceSpec>(),
		auto_advance_questions_to_research: boolean('auto_advance_questions_to_research').default(false).notNull(),
		auto_advance_research_to_design: boolean('auto_advance_research_to_design').default(false).notNull(),
		auto_advance_plan_to_worktree: boolean('auto_advance_plan_to_worktree').default(false).notNull(),
		auto_advance_worktree_to_implementation: boolean('auto_advance_worktree_to_implementation')
			.default(false)
			.notNull(),
		auto_advance_implementation_to_pr: boolean('auto_advance_implementation_to_pr').default(false).notNull(),

		/**
		 * Task-level Slack mute. When true, owner-filtered Slack notification automations skip this task;
		 * org-wide automations ignore it. Set by the task owner from the task header bell.
		 */
		slack_notifications_muted: boolean('slack_notifications_muted').default(false).notNull(),
	},
	(t) => [
		index('tasks_org_resource_owner_idx').on(t.organization_id, t.resource_owner_user_id),
		index('tasks_org_project_workspace_idx').on(t.organization_id, t.project_id, t.workspace_id),
		unique('tasks_organization_id_id_unique').on(t.organization_id, t.id),
	],
)

export const taskSelectSchema = createSelectSchema(tasks, {
	setup_status: z.enum(['pending', 'in_progress', 'completed', 'failed']).nullable(),
	ticket_provider: z.enum(['linear', 'jira', 'github']).nullable(),
	workflow_type: z.enum(TASK_WORKFLOW_TYPES),
	worktree_timing: z.enum(WORKTREE_TIMINGS),
	// Electric ships JSONB as strings over the wire
	workspace_state: jsonbParser(WorkspaceStateSchema.nullable()),
	workspace_spec: jsonbParser(WorkspaceSpecSchema.nullable()),
	created_with_experiment_flags: jsonbParser(CreatedWithExperimentFlagsSchema.nullable()),
})
export const taskInsertSchema = createInsertSchema(tasks, {
	workspace_state: WorkspaceStateSchema.nullish(),
	workspace_spec: WorkspaceSpecSchema.nullish(),
	created_with_experiment_flags: CreatedWithExperimentFlagsSchema.nullish(),
})
export const taskUpdateSchema = createUpdateSchema(tasks, {
	workspace_state: WorkspaceStateSchema.nullish(),
	workspace_spec: WorkspaceSpecSchema.nullish(),
	created_with_experiment_flags: CreatedWithExperimentFlagsSchema.nullish(),
})
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
