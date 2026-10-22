import { createHash, randomBytes } from 'node:crypto'

import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { slackIntegrationInstallStates } from '@humanlayer/db/tables/slack-integration-install-states'
import { slackIntegrations, type SlackIntegration } from '@humanlayer/db/tables/slack-integrations'
import { slackNotificationThreads } from '@humanlayer/db/tables/slack-notification-threads'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { Clock, Effect } from 'effect'

import { PostgresDb } from '../postgres/postgres-db.service'
import {
	SlackInstallStateInvalidError,
	SlackIntegrationUnavailableError,
	SlackNeedsReauthError,
	SlackNotConnectedError,
} from './slack.errors'
import type {
	ConsumeSlackInstallStateResult,
	CreateSlackInstallStateInput,
	CreateSlackInstallStateResult,
	MarkSlackThreadDeliveryFailedInput,
	RecordSlackConnectionInput,
	SlackConnectionStatus,
} from './slack.types'

/**
 * This creates the `state` value for the OAuth URL that is bound to the requestor's organization
 * They can then share the URL with a slack admin who might not be a HumanLayer admin
 *
 * When we receive an OAuth callback, we check the `state` and resolve it to the organization so we know which organization to save the tokens to.
 * @param input
 * @returns
 */
export const createSlackInstallState = (
	input: CreateSlackInstallStateInput,
): Effect.Effect<CreateSlackInstallStateResult, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		const state = randomBytes(32).toString('base64url')
		// Slack install links are valid for 7 days so admins have time to complete OAuth.
		const expiresAt = (yield* Clock.currentTimeMillis) + 7 * 24 * 60 * 60 * 1000

		yield* pg
			.query(
				pg.client.insert(slackIntegrationInstallStates).values({
					state_token_hash: hashState(state),
					organization_id: input.organizationId,
					requested_by_user_id: input.requestedByUserId,
					expires_at: BigInt(expiresAt),
				}),
			)
			.pipe(
				Effect.tapError((error) => Effect.logError('Slack install-state insert failed', error)),
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
			)

		return { state, expiresAt }
	})

export const getSlackConnectionStatus = (
	organizationId: string,
): Effect.Effect<SlackConnectionStatus, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		const [row] = yield* pg
			.query(
				pg.client
					.select({ integration: slackIntegrations, settings: organizationSettings })
					.from(organizationSettings)
					.leftJoin(
						slackIntegrations,
						eq(slackIntegrations.organization_id, organizationSettings.organization_id),
					)
					.where(eq(organizationSettings.organization_id, organizationId))
					.limit(1),
			)
			.pipe(Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })))

		const integration = row?.integration
		return {
			connected: Boolean(integration),
			enabled: Boolean(row?.settings.slack_integration_enabled && integration && !integration.needs_reauth),
			needsReauth: integration?.needs_reauth ?? false,
			teamName: integration?.slack_team_name ?? undefined,
			lastErrorCode: integration?.last_error_code ?? undefined,
		}
	})

export const disconnectSlackIntegration = (
	organizationId: string,
): Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		yield* pg
			.query(pg.client.delete(slackIntegrations).where(eq(slackIntegrations.organization_id, organizationId)))
			.pipe(Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })))
		yield* setSlackIntegrationEnabled(organizationId, false)
	})

/** Claims a one-time OAuth state token and returns the organization it was created for. */
export const consumeSlackInstallState = (
	state: string,
): Effect.Effect<
	ConsumeSlackInstallStateResult,
	SlackInstallStateInvalidError | SlackIntegrationUnavailableError,
	PostgresDb
> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		const now = BigInt(yield* Clock.currentTimeMillis)
		return yield* pg
			.transaction((tx) =>
				Effect.gen(function* () {
					const [claim] = yield* tx.query(
						tx.client
							.update(slackIntegrationInstallStates)
							.set({ consumed_at: now })
							.where(
								and(
									eq(slackIntegrationInstallStates.state_token_hash, hashState(state)),
									isNull(slackIntegrationInstallStates.consumed_at),
									gt(slackIntegrationInstallStates.expires_at, now),
								),
							)
							.returning(),
					)
					if (!claim) {
						return yield* Effect.fail(new SlackInstallStateInvalidError({ reason: 'invalid_or_expired' }))
					}
					return { organizationId: claim.organization_id, requestedByUserId: claim.requested_by_user_id }
				}),
			)
			.pipe(
				Effect.catchTag('SlackInstallStateInvalidError', (error) => Effect.fail(error)),
				Effect.catchTag('PostgresDbQueryError', (cause) =>
					Effect.fail(new SlackIntegrationUnavailableError({ cause })),
				),
				Effect.catchTag('PostgresDbTransactionError', (cause) =>
					Effect.fail(new SlackIntegrationUnavailableError({ cause })),
				),
			)
	})

/** Sets whether Slack notifications are enabled for an organization. */
export const setSlackIntegrationEnabled = (
	organizationId: string,
	enabled: boolean,
): Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.insert(organizationSettings)
					.values({ organization_id: organizationId, slack_integration_enabled: enabled })
					.onConflictDoUpdate({
						target: organizationSettings.organization_id,
						set: { slack_integration_enabled: enabled, updated_at: BigInt(yield* Clock.currentTimeMillis) },
					}),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.asVoid,
			)
	})

/** Stores the bot token returned by Slack OAuth for the organization. */
export const recordSlackConnection = (
	input: RecordSlackConnectionInput,
): Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.insert(slackIntegrations)
					.values({
						organization_id: input.organizationId,
						connected_by_user_id: input.connectedByUserId,
						bot_access_token: input.botAccessToken,
						bot_user_id: input.botUserId,
						scopes: input.scopes,
						slack_team_id: input.teamId,
						slack_team_name: input.teamName,
						app_id: input.appId,
						needs_reauth: false,
						last_error_code: null,
					})
					.onConflictDoUpdate({
						target: slackIntegrations.organization_id,
						set: {
							connected_by_user_id: input.connectedByUserId,
							bot_access_token: input.botAccessToken,
							bot_user_id: input.botUserId,
							scopes: input.scopes,
							slack_team_id: input.teamId,
							slack_team_name: input.teamName,
							app_id: input.appId,
							needs_reauth: false,
							last_error_code: null,
							updated_at: BigInt(yield* Clock.currentTimeMillis),
						},
					}),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.asVoid,
			)
	})

/** Loads a usable Slack connection or fails with the reconnect action required by the caller. */
export const requireSlackConnection = (
	organizationId: string,
): Effect.Effect<
	SlackIntegration,
	SlackIntegrationUnavailableError | SlackNotConnectedError | SlackNeedsReauthError,
	PostgresDb
> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.select()
					.from(slackIntegrations)
					.where(eq(slackIntegrations.organization_id, organizationId))
					.limit(1),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.flatMap(
					([integration]): Effect.Effect<
						SlackIntegration,
						SlackNotConnectedError | SlackNeedsReauthError
					> => {
						if (!integration) return Effect.fail(new SlackNotConnectedError({ organizationId }))
						if (integration.needs_reauth) {
							return Effect.fail(
								new SlackNeedsReauthError({
									organizationId,
									lastErrorCode: integration.last_error_code ?? undefined,
								}),
							)
						}
						return Effect.succeed(integration)
					},
				),
			)
	})

/** Marks the organization Slack token/scopes as requiring a reconnect. */
export const markSlackConnectionNeedsReauth = (
	organizationId: string,
	lastErrorCode: string,
): Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.update(slackIntegrations)
					.set({
						needs_reauth: true,
						last_error_code: lastErrorCode,
						updated_at: BigInt(yield* Clock.currentTimeMillis),
					})
					.where(eq(slackIntegrations.organization_id, organizationId)),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.asVoid,
			)
	})

/** Records a channel/thread-specific Slack delivery problem for Settings guidance. */
export const markSlackThreadDeliveryFailed = (
	input: MarkSlackThreadDeliveryFailedInput,
): Effect.Effect<void, SlackIntegrationUnavailableError, PostgresDb> =>
	Effect.gen(function* () {
		const pg = yield* PostgresDb
		return yield* pg
			.query(
				pg.client
					.update(slackNotificationThreads)
					.set({
						status: 'failed',
						last_error_code: input.errorCode,
						updated_at: BigInt(yield* Clock.currentTimeMillis),
					})
					.where(
						and(
							eq(slackNotificationThreads.automation_id, input.automationId),
							eq(slackNotificationThreads.channel_id, input.channelId),
							eq(slackNotificationThreads.task_id, input.taskId),
						),
					),
			)
			.pipe(
				Effect.mapError((cause) => new SlackIntegrationUnavailableError({ cause })),
				Effect.asVoid,
			)
	})

const hashState = (state: string): string => createHash('sha256').update(state).digest('hex')
