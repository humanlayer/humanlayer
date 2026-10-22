import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { organizations } from '@humanlayer/db/tables/organizations'
import { and, eq } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { Entitlements } from '../../../../effects/services/billing/entitlements.service'
import { hasActiveInstalledRepository } from '../../../../effects/services/github/github.persistence'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import { effectOrpcBaseForOrganizationAdmin } from '../../../effect-base'

export const setOrgSettingsEffectProcedure =
	effectOrpcBaseForOrganizationAdmin.auth.admin.organizations.settings.set.effect(function* ({
		input,
		context,
		errors,
	}) {
		const postgres = yield* PostgresDb
		const entitlements = yield* Entitlements
		const { organizationId } = context.auth
		const updatedAt = BigInt(yield* Clock.currentTimeMillis)

		const updateSet: Partial<typeof organizationSettings.$inferInsert> = { updated_at: updatedAt }
		if (input.experimentalSubagentsEnabled !== undefined) {
			updateSet.experimental_subagents_enabled = input.experimentalSubagentsEnabled
		}
		if (input.haikuResearchSubagentsEnabled !== undefined) {
			updateSet.haiku_research_subagents_enabled = input.haikuResearchSubagentsEnabled
		}
		if (input.jiraIntegrationEnabled !== undefined) {
			updateSet.jira_integration_enabled = input.jiraIntegrationEnabled
		}
		if (input.linearIntegrationEnabled !== undefined) {
			updateSet.linear_integration_enabled = input.linearIntegrationEnabled
		}
		if (input.slackIntegrationEnabled !== undefined) {
			updateSet.slack_integration_enabled = input.slackIntegrationEnabled
		}
		if (input.githubIntegrationEnabled !== undefined) {
			updateSet.github_integration_enabled = input.githubIntegrationEnabled
		}
		if (input.multiplayerPromptingEnabled !== undefined) {
			updateSet.multiplayer_prompting_enabled = input.multiplayerPromptingEnabled
		}
		if (input.defaultTaskShareLevel !== undefined) {
			updateSet.default_task_share_level = input.defaultTaskShareLevel
		}
		if (input.enableCreatingPubliclyShareableLinks !== undefined) {
			updateSet.enable_creating_publicly_shareable_links = input.enableCreatingPubliclyShareableLinks
		}
		if (input.accessRequestsEnabled !== undefined) {
			updateSet.access_requests_enabled = input.accessRequestsEnabled
		}
		// Only turning any of them on needs the entitlement. Daemons keep collecting regardless of
		// billing and the audience gate honours a stored flag the moment the entitlement check fails
		// open, so a lapsed org must still be able to turn them all off.
		const entitledSwitches: ReadonlyArray<{ readonly enabled: boolean | undefined; readonly name: string }> = [
			{ enabled: input.commitTrackingEnabled, name: 'Commit tracking' },
			{ enabled: input.prTrackingEnabled, name: 'Pull request tracking' },
			{
				enabled: input.advancedMetricsVisibleToAllMembers,
				name: 'Sharing Advanced metrics with every member',
			},
		]
		const switchTurningOn = entitledSwitches.find((entitled) => entitled.enabled === true)
		if (switchTurningOn !== undefined) {
			if (!(yield* entitlements.hasFeature(organizationId, 'advancedMetrics'))) {
				return yield* Effect.fail(
					errors.METRICS_BILLING_REQUIRED({
						data: { message: `${switchTurningOn.name} needs a Pro or Enterprise plan.` },
					}),
				)
			}
		}
		if (input.commitTrackingEnabled !== undefined) {
			updateSet.commit_tracking_enabled = input.commitTrackingEnabled
		}
		// Pull requests also need a place to read them from: the server discovers them through the
		// GitHub App, so an org with no installation would turn on a switch that collects nothing.
		if (input.prTrackingEnabled === true) {
			const installed = yield* hasActiveInstalledRepository({ organizationId }).pipe(
				Effect.catchTag('GitHubIntegrationUnavailableError', () => Effect.fail(errors.SERVICE_UNAVAILABLE())),
			)
			if (!installed) {
				return yield* Effect.fail(
					errors.GITHUB_INSTALLATION_REQUIRED({
						data: {
							message:
								'Install the HumanLayer GitHub App on at least one repository to track pull requests.',
						},
					}),
				)
			}
		}
		if (input.prTrackingEnabled !== undefined) {
			updateSet.pr_tracking_enabled = input.prTrackingEnabled
		}
		// A pull request is credited to a session through the commits it stamped, so pull request
		// tracking collects nothing without commit tracking and follows it off.
		if (input.commitTrackingEnabled === false) {
			updateSet.pr_tracking_enabled = false
		}
		if (input.advancedMetricsVisibleToAllMembers !== undefined) {
			updateSet.advanced_metrics_visible_to_all_members = input.advancedMetricsVisibleToAllMembers
		}

		return yield* postgres
			.transaction((transaction) =>
				Effect.gen(function* () {
					// Serializes with sharing.artifact.update (FOR SHARE on the same row), so a share
					// in flight either sees public links off or is revoked below. NO KEY UPDATE keeps
					// inserts into tables with a foreign key to organizations unblocked.
					yield* transaction.query(
						transaction.client
							.select({ id: organizations.id })
							.from(organizations)
							.where(eq(organizations.id, organizationId))
							.for('no key update'),
					)
					const [existing] = yield* transaction.query(
						transaction.client
							.select()
							.from(organizationSettings)
							.where(eq(organizationSettings.organization_id, organizationId))
							.limit(1)
							.for('no key update'),
					)

					const commitTrackingOn = input.commitTrackingEnabled ?? existing?.commit_tracking_enabled ?? false
					if (input.prTrackingEnabled === true && !commitTrackingOn) {
						return yield* Effect.fail(
							errors.COMMIT_TRACKING_REQUIRED({
								data: { message: 'Turn on commit tracking to track pull requests.' },
							}),
						)
					}

					const [row] = yield* transaction.query(
						transaction.client
							.insert(organizationSettings)
							.values({
								organization_id: organizationId,
								experimental_subagents_enabled: input.experimentalSubagentsEnabled ?? false,
								haiku_research_subagents_enabled: input.haikuResearchSubagentsEnabled ?? true,
								jira_integration_enabled: input.jiraIntegrationEnabled ?? false,
								linear_integration_enabled: input.linearIntegrationEnabled ?? false,
								slack_integration_enabled: input.slackIntegrationEnabled ?? false,
								github_integration_enabled: input.githubIntegrationEnabled ?? false,
								multiplayer_prompting_enabled: input.multiplayerPromptingEnabled ?? false,
								default_task_share_level: input.defaultTaskShareLevel ?? 'edit',
								enable_creating_publicly_shareable_links:
									input.enableCreatingPubliclyShareableLinks ?? true,
								access_requests_enabled: input.accessRequestsEnabled ?? true,
								commit_tracking_enabled: input.commitTrackingEnabled ?? false,
								pr_tracking_enabled: input.prTrackingEnabled ?? false,
								advanced_metrics_visible_to_all_members:
									input.advancedMetricsVisibleToAllMembers ?? false,
								updated_at: updatedAt,
							})
							.onConflictDoUpdate({ target: organizationSettings.organization_id, set: updateSet })
							.returning(),
					)

					if (!row) return yield* Effect.fail(errors.INTERNAL_SERVER_ERROR())

					const publicLinksWereEnabled = existing?.enable_creating_publicly_shareable_links ?? true
					if (input.enableCreatingPubliclyShareableLinks === false && publicLinksWereEnabled) {
						yield* transaction.query(
							transaction.client
								.update(artifacts)
								.set({ share_enabled: false, public_permission: 'off' })
								.where(
									and(
										eq(artifacts.organization_id, organizationId),
										eq(artifacts.share_enabled, true),
									),
								),
						)
					}

					return {
						experimentalSubagentsEnabled: row.experimental_subagents_enabled,
						haikuResearchSubagentsEnabled: row.haiku_research_subagents_enabled,
						jiraIntegrationEnabled: row.jira_integration_enabled,
						linearIntegrationEnabled: row.linear_integration_enabled,
						slackIntegrationEnabled: row.slack_integration_enabled,
						githubIntegrationEnabled: row.github_integration_enabled,
						multiplayerPromptingEnabled: row.multiplayer_prompting_enabled,
						defaultTaskShareLevel: row.default_task_share_level,
						syncVersion: 2 as const,
						syncVisibility: 'v2' as const,
						enableCreatingPubliclyShareableLinks: row.enable_creating_publicly_shareable_links,
						accessRequestsEnabled: row.access_requests_enabled,
						commitTrackingEnabled: row.commit_tracking_enabled,
						prTrackingEnabled: row.pr_tracking_enabled,
						advancedMetricsVisibleToAllMembers: row.advanced_metrics_visible_to_all_members,
					}
				}),
			)
			.pipe(
				Effect.tap(() =>
					Effect.logInfo('Organization settings updated').pipe(Effect.annotateLogs({ organizationId })),
				),
				Effect.tapError((error) =>
					Effect.logError('Organization settings update failed', error).pipe(
						Effect.annotateLogs({ organizationId }),
					),
				),
				Effect.catchTags({
					PostgresDbQueryError: (error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { operation: 'auth.admin.organizations.settings.set' },
								extra: { organizationId },
							}),
						).pipe(Effect.andThen(mapPostgresErrorToResponse(error, errors))),
					PostgresDbTransactionError: (error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { operation: 'auth.admin.organizations.settings.set' },
								extra: { organizationId },
							}),
						).pipe(Effect.andThen(mapPostgresErrorToResponse(error, errors))),
				}),
			)
	})
