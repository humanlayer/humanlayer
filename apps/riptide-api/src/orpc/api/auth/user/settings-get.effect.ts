import { jiraIntegrations } from '@humanlayer/db/tables/jira-integrations'
import { linearIntegrations } from '@humanlayer/db/tables/linear-integrations'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { userSettings } from '@humanlayer/db/tables/user-settings'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'

import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

const USER_DEFAULTS = {
	theme: 'catppuccin',
	experimental_subagents_enabled: false,
	claude_code_effect_runtime_enabled: false,
	haiku_research_subagents_enabled: false,
	default_model: 'opus',
	default_agent: 'claude' as const,
	prefer_batch_queue_delivery: true,
	sidebar_variant: 'flat' as 'flat' | 'grouped',
	show_task_phase_labels: false,
	projects_v2_enabled: false,
	projects_v2_assigned_variant: null,
	projects_v2_assigned_at: null,
	experiment_flags: {},
	onboarding_dismissed_at: null,
	first_task_completed_at: null,
	first_structured_workflow_completed_at: null,
	first_inbound_comment_received_at: null,
	// TRUE, matching the column default and daemon.settings.get's USER_DEFAULTS: a member with no
	// settings row has made no choice, and the org opt-in is the decision. This is a row-absent
	// default for a COLLECTION flag, so it has to agree with the other two or the UI
	// and the daemon disagree about the same member.
	metrics_advanced_enabled: true,
}

const ORG_DEFAULTS = {
	experimental_subagents_enabled: false,
	haiku_research_subagents_enabled: false,
	jira_integration_enabled: false,
	linear_integration_enabled: false,
	multiplayer_prompting_enabled: false,
	enable_creating_publicly_shareable_links: true,
	commit_tracking_enabled: false,
}

export const getUserSettingsEffectProcedure = effectOrpcBaseOrganizationRequired.auth.user.settings.get.effect(
	function* ({ context, errors }) {
		// services
		const postgres = yield* PostgresDb

		// impl
		const { userId, organizationId } = context.auth

		return yield* Effect.all(
			[
				postgres.query(
					postgres.client
						.select()
						.from(userSettings)
						.where(and(eq(userSettings.user_id, userId), eq(userSettings.organization_id, organizationId))),
				),
				postgres.query(
					postgres.client
						.select()
						.from(organizationSettings)
						.where(eq(organizationSettings.organization_id, organizationId)),
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
			Effect.map(([userRows, orgRows, jiraRows, linearRows]) => {
				const user = userRows[0] ?? USER_DEFAULTS
				const org = orgRows[0] ?? ORG_DEFAULTS
				const jiraIntegration = jiraRows[0] ?? null
				const linearIntegration = linearRows[0] ?? null
				return {
					effective: {
						experimentalSubagentsEnabled:
							org.experimental_subagents_enabled && user.experimental_subagents_enabled,
						claudeCodeEffectRuntimeEnabled: user.claude_code_effect_runtime_enabled,
						haikuResearchSubagentsEnabled:
							org.haiku_research_subagents_enabled && user.haiku_research_subagents_enabled,
						jiraEnabled:
							(org.jira_integration_enabled ?? false) &&
							!!jiraIntegration &&
							!jiraIntegration.needs_reauth,
						linearEnabled:
							(org.linear_integration_enabled ?? false) &&
							!!linearIntegration &&
							!linearIntegration.needs_reauth,
					},
					userSettings: {
						theme: user.theme,
						experimentalSubagentsEnabled: user.experimental_subagents_enabled,
						claudeCodeEffectRuntimeEnabled: user.claude_code_effect_runtime_enabled,
						haikuResearchSubagentsEnabled: user.haiku_research_subagents_enabled,
						defaultModel: user.default_model,
						defaultAgent: user.default_agent,
						preferBatchQueueDelivery: user.prefer_batch_queue_delivery,
						sidebarVariant: user.sidebar_variant,
						showTaskPhaseLabels: user.show_task_phase_labels,
						projectsV2Enabled: user.projects_v2_enabled,
						projectsV2AssignedVariant: user.projects_v2_assigned_variant,
						projectsV2AssignedAt:
							user.projects_v2_assigned_at === null ? null : Number(user.projects_v2_assigned_at),
						experiments: user.experiment_flags,
						onboardingDismissedAt:
							user.onboarding_dismissed_at === null ? null : Number(user.onboarding_dismissed_at),
						firstTaskCompletedAt:
							user.first_task_completed_at === null ? null : Number(user.first_task_completed_at),
						firstStructuredWorkflowCompletedAt:
							user.first_structured_workflow_completed_at === null
								? null
								: Number(user.first_structured_workflow_completed_at),
						firstInboundCommentReceivedAt:
							user.first_inbound_comment_received_at === null
								? null
								: Number(user.first_inbound_comment_received_at),
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
						// EFFECTIVE, not the raw org flag: report the same org-AND-member
						// collection setting as daemon.settings.get, including member exclusions.
						commitTrackingEnabled: (org.commit_tracking_enabled ?? false) && user.metrics_advanced_enabled,
					},
					jiraNeedsReauth: jiraIntegration?.needs_reauth ?? false,
					jiraSiteUrl: jiraIntegration?.site_url ?? null,
					linearNeedsReauth: linearIntegration?.needs_reauth ?? false,
				}
			}),
			Effect.tap(() =>
				Effect.logInfo('User settings fetched').pipe(Effect.annotateLogs({ userId, organizationId })),
			),
			Effect.tapError((e) => Effect.logError(e)),
			Effect.tapError((e) => Effect.sync(() => Sentry.captureException(e))),
			Effect.catchTags({
				PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
			}),
		)
	},
)
