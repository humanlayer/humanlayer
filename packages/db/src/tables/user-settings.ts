import { type LaunchableCodingAgent, LaunchableCodingAgentZodSchema } from '@humanlayer/schemas/coding-agent'
import { sql } from 'drizzle-orm'
import { bigint, boolean, check, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import z from 'zod/v4'

import { jsonbParser } from '../utils/jsonb-parser'
import { type ProjectsV2Variant, ProjectsV2VariantSchema } from '../zodschemas/projects-v2-variant'
import { organizations } from './organizations'

type DefaultCodingAgent = LaunchableCodingAgent
const DefaultCodingAgentSchema = LaunchableCodingAgentZodSchema

export const EXPERIMENT_FLAG_NAMES = [
	'daemonDrivenWorkspaceSetupEnabled',
	'billingPreviewEnabled',
	'diffViewerEnabled',
	'scratchPadEnabled',
	'githubPrPanelEnabled',
	'roundedCornersEnabled',
	'useFoldCodingAgent',
	'thinkingVerbsDisabled',
	'agentCommandDiscoveryEnabled',
	'claudeInAppSignInEnabled',
	'codexInAppSignInEnabled',
	'hostStatsEnabled',
] as const
export type ExperimentFlagName = (typeof EXPERIMENT_FLAG_NAMES)[number]

// A key is absent until the user has flipped that switch somewhere, so every
// client keeps its own local value for absent keys instead of resetting to a default.
export const ExperimentFlagsSchema = z.object(
	Object.fromEntries(EXPERIMENT_FLAG_NAMES.map((name) => [name, z.boolean().optional()])) as Record<
		ExperimentFlagName,
		z.ZodOptional<z.ZodBoolean>
	>,
)
export type ExperimentFlags = z.infer<typeof ExperimentFlagsSchema>

export const userSettings = pgTable(
	'user_settings',
	{
		user_id: text().notNull(),
		organization_id: uuid('organization_id')
			.references(() => organizations.id, { onDelete: 'cascade' })
			.notNull(),
		theme: text('theme').notNull().default('catppuccin'),
		experimental_subagents_enabled: boolean('experimental_subagents_enabled').notNull().default(false),
		claude_code_effect_runtime_enabled: boolean('claude_code_effect_runtime_enabled').notNull().default(false),
		haiku_research_subagents_enabled: boolean('haiku_research_subagents_enabled').notNull().default(false),
		default_model: text('default_model').notNull().default('opus'),
		default_agent: text('default_agent').$type<DefaultCodingAgent>().notNull().default('claude'),
		// Queue delivery mode: true = batch (all pending messages at once), false = one at a time
		prefer_batch_queue_delivery: boolean('prefer_batch_queue_delivery').notNull().default(true),
		sidebar_variant: text('sidebar_variant').$type<'flat' | 'grouped'>().notNull().default('flat'),
		show_task_phase_labels: boolean('show_task_phase_labels').notNull().default(false),
		projects_v2_enabled: boolean('projects_v2_enabled').notNull().default(false),
		// The Projects V2 experiment group PostHog first chose in this organization, and when the
		// server saved it. Written once (only while null) by auth.user.settings.update; never
		// rewritten by later flag values. Separate from projects_v2_enabled, which is current access
		// and can move from false to true through manual opt-in without changing the original group.
		projects_v2_assigned_variant: text('projects_v2_assigned_variant').$type<ProjectsV2Variant>(),
		projects_v2_assigned_at: bigint('projects_v2_assigned_at', { mode: 'bigint' }),
		experiment_flags: jsonb('experiment_flags').$type<ExperimentFlags>().notNull().default({}),
		onboarding_dismissed_at: bigint('onboarding_dismissed_at', { mode: 'bigint' }),
		first_task_completed_at: bigint('first_task_completed_at', { mode: 'bigint' }),
		first_structured_workflow_completed_at: bigint('first_structured_workflow_completed_at', { mode: 'bigint' }),
		first_inbound_comment_received_at: bigint('first_inbound_comment_received_at', { mode: 'bigint' }),
		// Admin-controlled Advanced Metrics opt-out: gates BOTH commit and PR collection for this
		// user (effective = org collection flag && this). Written only via
		// auth.admin.users.setMetricsAdvancedEnabled — deliberately absent from the user-facing
		// settings contract, so users can neither see nor flip it themselves.
		//
		// Defaults TRUE so the ORG opt-in is the whole decision: an org that turns collection on
		// collects for its members, and an admin excludes individuals by flipping this off. It
		// shipped as default-false, which made every existing member silently uncollected the
		// moment the AND-term landed — the org flag stayed on and nothing recorded. A default
		// here only covers rows that get INSERTed, so every row-absent reader must default to true
		// too, or two surfaces disagree about the same member:
		//   - `USER_DEFAULTS` in daemon/settings/get.effect.ts — governs the daemon's collectors
		//   - `USER_DEFAULTS` in api/auth/user/settings-get.effect.ts — reports the same effective
		//     collection setting to the UI
		//   - `auth.admin.users.list` — the Users panel switch, which must show what is collected
		metrics_advanced_enabled: boolean('metrics_advanced_enabled').notNull().default(true),

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
		primaryKey({ name: 'user_settings_pk', columns: [t.user_id, t.organization_id] }),
		check(
			'user_settings_projects_v2_assigned_variant_check',
			sql`${t.projects_v2_assigned_variant} IN ('v1', 'v2')`,
		),
	],
)

export const userSettingsSelectSchema = createSelectSchema(userSettings, {
	default_agent: DefaultCodingAgentSchema,
	experiment_flags: jsonbParser(ExperimentFlagsSchema),
	projects_v2_assigned_variant: ProjectsV2VariantSchema.nullable(),
})
export const userSettingsInsertSchema = createInsertSchema(userSettings, {
	default_agent: DefaultCodingAgentSchema.optional(),
	experiment_flags: ExperimentFlagsSchema.optional(),
	projects_v2_assigned_variant: ProjectsV2VariantSchema.nullable().optional(),
})
export const userSettingsUpdateSchema = createUpdateSchema(userSettings, {
	default_agent: DefaultCodingAgentSchema.optional(),
	experiment_flags: ExperimentFlagsSchema.optional(),
	projects_v2_assigned_variant: ProjectsV2VariantSchema.nullable().optional(),
})
export type UserSettings = typeof userSettings.$inferSelect
export type NewUserSettings = typeof userSettings.$inferInsert
