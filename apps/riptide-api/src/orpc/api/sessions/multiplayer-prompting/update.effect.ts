import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import type { MultiplayerPromptingDuration } from '@humanlayer/riptide-api-contract/api/sessions/multiplayer-prompting/update'
import { and, eq, inArray } from 'drizzle-orm'
import { Clock, Data, Effect } from 'effect'

import { createTaskUserAcl, updateTaskUserAcl } from '../../../../effects/services/postgres/acl-operations'
import { mapPostgresErrorToResponse } from '../../../../effects/services/postgres/error-mapping'
import { getTransactionId } from '../../../../effects/services/postgres/helpers'
import { PostgresDb } from '../../../../effects/services/postgres/postgres-db.service'
import { Sentry } from '../../../../instrument'
import {
	getSessionAccessControlLevel,
	SessionAccessControl,
	SessionDoesNotExistError,
} from '../../../../lib/session-multiplayer-prompting-auth'
import { effectOrpcBaseOrganizationRequired } from '../../../effect-base'

class MultiplayerPromptingForbiddenError extends Data.TaggedError('MultiplayerPromptingForbiddenError') {}
class MultiplayerPromptingFeatureDisabledError extends Data.TaggedError('MultiplayerPromptingFeatureDisabledError') {}
class InvalidMultiplayerPromptingSettingsError extends Data.TaggedError('InvalidMultiplayerPromptingSettingsError')<{
	message: string
}> {}
class MultiplayerPromptingAclError extends Data.TaggedError('MultiplayerPromptingAclError')<{
	cause: unknown
}> {}

const DURATION_MILLIS: Record<Exclude<MultiplayerPromptingDuration, 'unlimited'>, number> = {
	'15m': 15 * 60_000,
	'30m': 30 * 60_000,
	'1h': 60 * 60_000,
	'2h': 2 * 60 * 60_000,
	'1d': 24 * 60 * 60_000,
}

export const updateMultiplayerPromptingEffectProcedure =
	effectOrpcBaseOrganizationRequired.sessions.multiplayerPrompting.update.effect(function* ({
		input,
		context,
		errors,
	}) {
		const postgres = yield* PostgresDb
		const nowMillis = yield* Clock.currentTimeMillis
		const { organizationId, userId } = context.auth

		const result = yield* postgres
			.transaction((transaction) =>
				Effect.gen(function* () {
					const [session] = yield* transaction.query(
						transaction.client
							.select()
							.from(sessions)
							.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, organizationId)))
							.for('no key update')
							.limit(1),
					)
					if (!session) {
						return yield* Effect.fail(
							new SessionDoesNotExistError({ sessionId: input.sessionId, organizationId }),
						)
					}

					const accessLevel = yield* getSessionAccessControlLevel(
						transaction,
						{ organizationId, sessionId: input.sessionId, actorUserId: userId },
						nowMillis,
					)
					if (accessLevel !== SessionAccessControl.owner) {
						return yield* Effect.fail(new MultiplayerPromptingForbiddenError())
					}

					const [settings] = yield* transaction.query(
						transaction.client
							.select({ enabled: organizationSettings.multiplayer_prompting_enabled })
							.from(organizationSettings)
							.where(eq(organizationSettings.organization_id, organizationId))
							.limit(1),
					)
					if (!settings?.enabled) return yield* Effect.fail(new MultiplayerPromptingFeatureDisabledError())

					const transactionId = yield* getTransactionId(transaction)
					if (!input.settings.enabled) {
						yield* transaction.query(
							transaction.client
								.update(sessions)
								.set({ multiplayer_prompting_user_ids: [], multiplayer_prompting_expires_at: null })
								.where(eq(sessions.id, input.sessionId)),
						)
						return { transactionId }
					}

					const additions = input.settings.addUserIds ?? []
					const removals = input.settings.removeUserIds ?? []
					if (additions.some((id) => removals.includes(id))) {
						return yield* Effect.fail(
							new InvalidMultiplayerPromptingSettingsError({
								message: 'A user cannot be added and removed in the same update',
							}),
						)
					}
					if (additions.includes(userId)) {
						return yield* Effect.fail(
							new InvalidMultiplayerPromptingSettingsError({
								message: 'The session owner cannot be added as a prompter',
							}),
						)
					}

					const removeSet = new Set(removals)
					const roster = session.multiplayer_prompting_user_ids.filter((id) => !removeSet.has(id))
					for (const id of additions) if (!roster.includes(id)) roster.push(id)
					if (roster.length === 0) {
						return yield* Effect.fail(
							new InvalidMultiplayerPromptingSettingsError({
								message: 'At least one teammate must have prompt access',
							}),
						)
					}

					let startedAt = session.multiplayer_prompting_started_at
					let expiresAt = session.multiplayer_prompting_expires_at
					if (input.settings.duration) {
						startedAt = BigInt(nowMillis)
						expiresAt =
							input.settings.duration === 'unlimited'
								? null
								: BigInt(nowMillis + DURATION_MILLIS[input.settings.duration])
					}
					if (startedAt === null || (expiresAt !== null && expiresAt <= BigInt(nowMillis))) {
						return yield* Effect.fail(
							new InvalidMultiplayerPromptingSettingsError({
								message: 'A duration is required to start or restart prompt access',
							}),
						)
					}

					if (session.task_id && additions.length > 0) {
						const existingAcls = yield* transaction.query(
							transaction.client
								.select()
								.from(taskUserAcl)
								.where(
									and(
										eq(taskUserAcl.organization_id, organizationId),
										eq(taskUserAcl.task_id, session.task_id),
										inArray(taskUserAcl.subject_user_id, additions),
									),
								),
						)
						const byUserId = new Map(existingAcls.map((acl) => [acl.subject_user_id, acl]))
						for (const subjectUserId of additions) {
							const existing = byUserId.get(subjectUserId)
							if (!existing) {
								yield* createTaskUserAcl(transaction, {
									organizationId,
									subjectUserId,
									taskId: session.task_id,
									resourceOwnerUserId: session.resource_owner_user_id,
									permissionLevel: 'edit',
									grantedBy: userId,
								}).pipe(Effect.mapError((cause) => new MultiplayerPromptingAclError({ cause })))
							} else if (existing.permission_level !== 'edit') {
								yield* updateTaskUserAcl(transaction, {
									aclEntryId: existing.id,
									newPermissionLevel: 'edit',
									updatedBy: userId,
								}).pipe(Effect.mapError((cause) => new MultiplayerPromptingAclError({ cause })))
							}
						}
					}

					yield* transaction.query(
						transaction.client
							.update(sessions)
							.set({
								multiplayer_prompting_user_ids: roster,
								multiplayer_prompting_started_at: startedAt,
								multiplayer_prompting_expires_at: expiresAt,
							})
							.where(eq(sessions.id, input.sessionId)),
					)

					return { transactionId }
				}),
			)
			.pipe(
				Effect.tapError((error) =>
					Effect.sync(() =>
						Sentry.captureException(error, { extra: { organizationId, sessionId: input.sessionId } }),
					),
				),
				Effect.catchTags({
					SessionDoesNotExistError: () =>
						Effect.fail(errors.NOT_FOUND({ data: { message: 'Session not found' } })),
					MultiplayerPromptingForbiddenError: () =>
						Effect.fail(
							errors.FORBIDDEN({ data: { message: 'Only the session owner can manage prompt access' } }),
						),
					MultiplayerPromptingFeatureDisabledError: () =>
						Effect.fail(errors.FORBIDDEN({ data: { message: 'Multiplayer Prompting is disabled' } })),
					InvalidMultiplayerPromptingSettingsError: ({ message }) =>
						Effect.fail(errors.BAD_REQUEST({ data: { message } })),
					MultiplayerPromptingAclError: () => Effect.fail(errors.INTERNAL_SERVER_ERROR()),
					PostgresDbQueryError: (error) => mapPostgresErrorToResponse(error, errors),
					PostgresDbTransactionError: (error) => mapPostgresErrorToResponse(error, errors),
				}),
			)

		return result
	})
