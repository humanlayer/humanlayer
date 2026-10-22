import { sql } from 'drizzle-orm'
import { bigint, boolean, check, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod'
import z from 'zod/v4'

import { organizations } from './organizations'

export type SyncPathVersion = 1 | 2
export type SyncVisibility = 'v1' | 'v2' | 'user_choice'

/**
 * Zod schema for sync version (1 or 2).
 */
export const SyncVersionSchema = z.union([z.literal(1), z.literal(2)]) satisfies z.ZodType<SyncPathVersion>

/**
 * Zod schema for sync visibility.
 * - 'v1': Compatibility Mode - organization uses v1 sync exclusively
 * - 'v2': Organization-Wide Sync - organization uses v2 sync exclusively
 * - 'user_choice': Allow users to choose their sync version
 */
export const SyncVisibilitySchema = z.enum(['v1', 'v2', 'user_choice']) satisfies z.ZodType<SyncVisibility>

export const DefaultTaskShareLevelSchema = z.enum(['read', 'edit'])
export type DefaultTaskShareLevel = z.infer<typeof DefaultTaskShareLevelSchema>

export const organizationSettings = pgTable(
	'organization_settings',
	{
		organization_id: uuid()
			.primaryKey()
			.references(() => organizations.id, { onDelete: 'cascade' }),

		default_task_share_level: text('default_task_share_level')
			.notNull()
			.$type<DefaultTaskShareLevel>()
			.default('edit'),
		experimental_subagents_enabled: boolean('experimental_subagents_enabled').notNull().default(true),
		haiku_research_subagents_enabled: boolean('haiku_research_subagents_enabled').notNull().default(true),
		jira_integration_enabled: boolean('jira_integration_enabled').notNull().default(false),
		linear_integration_enabled: boolean('linear_integration_enabled').notNull().default(false),
		slack_integration_enabled: boolean('slack_integration_enabled').notNull().default(false),
		github_integration_enabled: boolean('github_integration_enabled').notNull().default(false),
		multiplayer_prompting_enabled: boolean('multiplayer_prompting_enabled').notNull().default(true),
		enable_creating_publicly_shareable_links: boolean('enable_creating_publicly_shareable_links')
			.notNull()
			.default(true),
		access_requests_enabled: boolean('access_requests_enabled').notNull().default(true),

		// Advanced Metrics COLLECTION, read by the daemon via daemon.settings.get. Whether an org
		// may see the Advanced Metrics page at all follows from its billing plan (see riptide-api's
		// entitlements); what an org decides for itself is collection and, below, the audience.
		//
		// Collection also reads the per-user `user_settings.metrics_advanced_enabled`, which
		// defaults TRUE, so turning one of these on collects for every member until an admin
		// excludes one via auth.admin.users.setMetricsAdvancedEnabled.
		//
		// `pr_tracking_enabled` is org-wide: the per-user exclusion above does not apply to it.
		// Turning it on needs a GitHub App installation that reaches at least one repository.
		commit_tracking_enabled: boolean('commit_tracking_enabled').notNull().default(false),
		pr_tracking_enabled: boolean('pr_tracking_enabled').notNull().default(false),

		// Advanced Metrics AUDIENCE, on top of the plan entitlement: who inside an entitled org
		// reaches the page. The page names individual members and what they cost, so the default
		// keeps it with the admins who can already see that in billing.
		advanced_metrics_visible_to_all_members: boolean('advanced_metrics_visible_to_all_members')
			.notNull()
			.default(false),

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
	(table) => [
		check(
			'organization_settings_default_task_share_level_check',
			sql`${table.default_task_share_level} IN ('read', 'edit')`,
		),
	],
)

export const organizationSettingsSelectSchema = createSelectSchema(organizationSettings, {
	default_task_share_level: DefaultTaskShareLevelSchema,
})
export const organizationSettingsInsertSchema = createInsertSchema(organizationSettings, {
	default_task_share_level: DefaultTaskShareLevelSchema.optional(),
})
export const organizationSettingsUpdateSchema = createUpdateSchema(organizationSettings, {
	default_task_share_level: DefaultTaskShareLevelSchema.optional(),
})
export type OrganizationSettings = typeof organizationSettings.$inferSelect
export type NewOrganizationSettings = typeof organizationSettings.$inferInsert
