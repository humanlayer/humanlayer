import { jiraIntegrations } from '@humanlayer/db/tables/jira-integrations'
import { linearIntegrations } from '@humanlayer/db/tables/linear-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { eq, isNull, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import { Clock, Effect } from 'effect'

import { ExperimentAnalyticsService } from '../../../../effects/services/experiment-analytics/experiment-analytics.service'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

const ORG_DEFAULTS = {
	experimental_subagents_enabled: false,
	haiku_research_subagents_enabled: false,
	jira_integration_enabled: false,
	linear_integration_enabled: false,
	multiplayer_prompting_enabled: false,
	enable_creating_publicly_shareable_links: true,
	commit_tracking_enabled: false,
}

export const updateUserSettingsEffectProcedure = effectOrpcBaseOrganizationRequired.auth.user.settings.update.effect(
	function* ({ input, context, errors }) {
		const postgres = yield* PostgresDb
		const { userId, organizationId } = context.auth

		// Fetch org settings, jira integration, and linear integration in parallel
		const [orgRows, jiraRows, linearRows] = yield* Effect.all(
			[
				postgres.query(
					postgres.client
						.select()
						.from(organizationSettings)
						.where(eq(organizationSettings.organization_id, organizationId))
						.limit(1),
				),
				postgres.query(
					postgres.client
						.select()
						.from(jiraIntegrations)
						.where(eq(jiraIntegrations.organization_id, organizationId))
						.limit(1),
				),
				postgres.query(
					postgres.client
						.select()
						.from(linearIntegrations)
						.where(eq(linearIntegrations.organization_id, organizationId))
						.limit(1),
				),
			],
			{ concurrency: 'unbounded' },
		).pipe(
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)

		const org = orgRows[0] ?? ORG_DEFAULTS
		const jiraIntegration = jiraRows[0] ?? null
		const linearIntegration = linearRows[0] ?? null
		// Validate: user cannot enable a feature the org has disabled
		if (input.experimentalSubagentsEnabled && !org.experimental_subagents_enabled) {
			return yield* Effect.fail(
				errors.FEATURE_DISABLED_BY_ORG({
					data: { message: 'Your organization has disabled this feature' },
				}),
			)
		}
		if (input.haikuResearchSubagentsEnabled && !org.haiku_research_subagents_enabled) {
			return yield* Effect.fail(
				errors.FEATURE_DISABLED_BY_ORG({
					data: { message: 'Your organization has disabled this feature' },
				}),
			)
		}

		// Build the set of columns to update (only those provided in input)
		const updateSet: PgUpdateSetSource<typeof userSettings> = {
			updated_at: BigInt(Date.now()),
		}
		if (input.theme !== undefined) updateSet.theme = input.theme
		if (input.experimentalSubagentsEnabled !== undefined)
			updateSet.experimental_subagents_enabled = input.experimentalSubagentsEnabled
		if (input.claudeCodeEffectRuntimeEnabled !== undefined)
			updateSet.claude_code_effect_runtime_enabled = input.claudeCodeEffectRuntimeEnabled
		if (input.haikuResearchSubagentsEnabled !== undefined)
			updateSet.haiku_research_subagents_enabled = input.haikuResearchSubagentsEnabled
		if (input.defaultModel !== undefined) updateSet.default_model = input.defaultModel
		if (input.defaultAgent !== undefined) updateSet.default_agent = input.defaultAgent
		if (input.preferBatchQueueDelivery !== undefined)
			updateSet.prefer_batch_queue_delivery = input.preferBatchQueueDelivery
		if (input.sidebarVariant !== undefined) updateSet.sidebar_variant = input.sidebarVariant
		if (input.showTaskPhaseLabels !== undefined) updateSet.show_task_phase_labels = input.showTaskPhaseLabels
		// Projects V2 access only turns on. `false` from older clients is accepted and ignored.
		if (input.projectsV2Enabled === true) updateSet.projects_v2_enabled = true
		else if (input.projectsV2AssignedVariant !== undefined)
			updateSet.projects_v2_enabled = sql`${userSettings.projects_v2_enabled} OR ${userSettings.projects_v2_assigned_variant} = 'v2'`
		if (input.experiments !== undefined)
			updateSet.experiment_flags = sql`${userSettings.experiment_flags} || ${JSON.stringify(input.experiments)}::jsonb`
		if (input.onboardingDismissedAt !== undefined)
			updateSet.onboarding_dismissed_at =
				input.onboardingDismissedAt === null ? null : BigInt(input.onboardingDismissedAt)

		const assignedVariant = input.projectsV2AssignedVariant
		const { row, assignmentSaved } = yield* postgres
			.transaction((tx) =>
				Effect.gen(function* () {
					// Save the first experiment group only while none is saved, so retries and later
					// flag values cannot replace it. A V2 group turns access on in the same write.
					// ON CONFLICT ... WHERE returns no row when a group already exists, which tells
					// this call whether it made the first save.
					let assignmentSaved = false
					if (assignedVariant !== undefined) {
						const assignedAt = BigInt(yield* Clock.currentTimeMillis)
						const assignmentSet: PgUpdateSetSource<typeof userSettings> = {
							projects_v2_assigned_variant: assignedVariant,
							projects_v2_assigned_at: assignedAt,
							updated_at: assignedAt,
						}
						if (assignedVariant === 'v2') assignmentSet.projects_v2_enabled = true
						const saved = yield* tx.query(
							tx.client
								.insert(userSettings)
								.values({
									user_id: userId,
									organization_id: organizationId,
									projects_v2_assigned_variant: assignedVariant,
									projects_v2_assigned_at: assignedAt,
									projects_v2_enabled: assignedVariant === 'v2',
								})
								.onConflictDoUpdate({
									target: [userSettings.user_id, userSettings.organization_id],
									set: assignmentSet,
									where: isNull(userSettings.projects_v2_assigned_variant),
								})
								.returning({ user_id: userSettings.user_id }),
						)
						assignmentSaved = saved.length > 0
					}

					const [row] = yield* tx.query(
						tx.client
							.insert(userSettings)
							.values({
								user_id: userId,
								organization_id: organizationId,
								theme: input.theme ?? 'catppuccin',
								experimental_subagents_enabled: input.experimentalSubagentsEnabled ?? false,
								claude_code_effect_runtime_enabled: input.claudeCodeEffectRuntimeEnabled ?? false,
								haiku_research_subagents_enabled: input.haikuResearchSubagentsEnabled ?? false,
								default_model: input.defaultModel ?? 'opus',
								default_agent: input.defaultAgent ?? 'claude',
								prefer_batch_queue_delivery: input.preferBatchQueueDelivery ?? true,
								sidebar_variant: input.sidebarVariant ?? 'flat',
								show_task_phase_labels: input.showTaskPhaseLabels ?? false,
								projects_v2_enabled: input.projectsV2Enabled === true,
								experiment_flags: input.experiments ?? {},
								onboarding_dismissed_at:
									input.onboardingDismissedAt === undefined || input.onboardingDismissedAt === null
										? null
										: BigInt(input.onboardingDismissedAt),
							})
							.onConflictDoUpdate({
								target: [userSettings.user_id, userSettings.organization_id],
								set: updateSet,
							})
							.returning(),
					)
					return { row, assignmentSaved }
				}),
			)
			.pipe(
				Effect.tap(() =>
					Effect.logInfo('User settings updated').pipe(Effect.annotateLogs({ userId, organizationId })),
				),
				Effect.tapError((e) => Effect.logError(e)),
				Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
				Effect.catchTags({
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		if (!row) {
			return yield* Effect.fail(
				errors.INTERNAL_SERVER_ERROR({ data: { message: 'Failed to upsert user settings' } }),
			)
		}

		if (assignmentSaved && row.projects_v2_assigned_variant !== null && row.projects_v2_assigned_at !== null) {
			const analytics = yield* ExperimentAnalyticsService
			// After commit and detached: analytics delivery never delays or fails the settings write.
			yield* analytics
				.recordProjectsV2Assigned({
					userId,
					organizationId,
					assignedVariant: row.projects_v2_assigned_variant,
					assignedAt: Number(row.projects_v2_assigned_at),
				})
				.pipe(Effect.forkDetach({ startImmediately: true }))
		}

		return {
			effective: {
				experimentalSubagentsEnabled: org.experimental_subagents_enabled && row.experimental_subagents_enabled,
				claudeCodeEffectRuntimeEnabled: row.claude_code_effect_runtime_enabled,
				haikuResearchSubagentsEnabled:
					org.haiku_research_subagents_enabled && row.haiku_research_subagents_enabled,
				jiraEnabled:
					(org.jira_integration_enabled ?? false) && !!jiraIntegration && !jiraIntegration.needs_reauth,
				linearEnabled:
					(org.linear_integration_enabled ?? false) && !!linearIntegration && !linearIntegration.needs_reauth,
			},
			userSettings: {
				theme: row.theme,
				experimentalSubagentsEnabled: row.experimental_subagents_enabled,
				claudeCodeEffectRuntimeEnabled: row.claude_code_effect_runtime_enabled,
				haikuResearchSubagentsEnabled: row.haiku_research_subagents_enabled,
				defaultModel: row.default_model,
				defaultAgent: row.default_agent,
				preferBatchQueueDelivery: row.prefer_batch_queue_delivery,
				sidebarVariant: row.sidebar_variant,
				showTaskPhaseLabels: row.show_task_phase_labels,
				projectsV2Enabled: row.projects_v2_enabled,
				projectsV2AssignedVariant: row.projects_v2_assigned_variant,
				projectsV2AssignedAt: row.projects_v2_assigned_at === null ? null : Number(row.projects_v2_assigned_at),
				experiments: row.experiment_flags,
				onboardingDismissedAt:
					row.onboarding_dismissed_at === null ? null : Number(row.onboarding_dismissed_at),
				firstTaskCompletedAt: row.first_task_completed_at === null ? null : Number(row.first_task_completed_at),
				firstStructuredWorkflowCompletedAt:
					row.first_structured_workflow_completed_at === null
						? null
						: Number(row.first_structured_workflow_completed_at),
				firstInboundCommentReceivedAt:
					row.first_inbound_comment_received_at === null
						? null
						: Number(row.first_inbound_comment_received_at),
			},
			orgSettings: {
				experimentalSubagentsEnabled: org.experimental_subagents_enabled,
				haikuResearchSubagentsEnabled: org.haiku_research_subagents_enabled,
				jiraIntegrationEnabled: org.jira_integration_enabled ?? false,
				linearIntegrationEnabled: org.linear_integration_enabled ?? false,
				multiplayerPromptingEnabled: org.multiplayer_prompting_enabled ?? false,
				syncVersion: 2 as const,
				syncVisibility: 'v2' as const,
				enableCreatingPubliclyShareableLinks: org.enable_creating_publicly_shareable_links ?? true,
				// EFFECTIVE, resolving the same AND as settings-get and daemon.settings.get.
				// `row` is the settings row this request just upserted, so no row-absent default applies here.
				commitTrackingEnabled: (org.commit_tracking_enabled ?? false) && row.metrics_advanced_enabled,
			},
			jiraNeedsReauth: jiraIntegration?.needs_reauth ?? false,
			jiraSiteUrl: jiraIntegration?.site_url ?? null,
		}
	},
)
