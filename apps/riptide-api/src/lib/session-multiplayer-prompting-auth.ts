import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { sessions } from '@humanlayer/db/tables/sessions'
import type { AclPermissionLevel } from '@humanlayer/db/tables/task-user-acl'
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import { Data, Effect } from 'effect'

import { getTaskWithEffectivePermissions } from '../db/task-auth'
import type { PostgresTransaction } from '../effects/services/postgres/postgres-db.service'

export const SessionAccessControl = {
	noAccess: 'no_access',
	view: 'view',
	prompt: 'prompt',
	owner: 'owner',
} as const

export type SessionAccessControlLevel = (typeof SessionAccessControl)[keyof typeof SessionAccessControl]

const SESSION_ACCESS_CONTROL_RANK: Record<SessionAccessControlLevel, number> = {
	no_access: 0,
	view: 1,
	prompt: 2,
	owner: 3,
}

export function hasRequiredSessionAccess(
	actualAccessLevel: SessionAccessControlLevel,
	requiredAccessLevel: SessionAccessControlLevel,
): boolean {
	return SESSION_ACCESS_CONTROL_RANK[actualAccessLevel] >= SESSION_ACCESS_CONTROL_RANK[requiredAccessLevel]
}

export class SessionDoesNotExistError extends Data.TaggedError('SessionDoesNotExistError')<{
	sessionId: string
	organizationId: string
}> {}

export interface MultiplayerPromptingGrant {
	multiplayerPromptingEnabledForOrganization: boolean
	multiplayerPromptingUserIds: string[]
	multiplayerPromptingStartedAt: bigint | null
	multiplayerPromptingExpiresAt: bigint | null
	nowMillis: number
}

export interface CalculateSessionAccessControlLevelInput extends MultiplayerPromptingGrant {
	actorUserId: string
	sessionCreatedBy: string
	sessionResourceOwnerUserId: string
	sessionTaskId: string | null
	effectiveTaskPermission: AclPermissionLevel | null
}

export function isMultiplayerPromptingActive(grant: MultiplayerPromptingGrant): boolean {
	const startedAt = grant.multiplayerPromptingStartedAt
	const expiresAt = grant.multiplayerPromptingExpiresAt
	return (
		grant.multiplayerPromptingEnabledForOrganization &&
		grant.multiplayerPromptingUserIds.length > 0 &&
		startedAt !== null &&
		startedAt <= BigInt(grant.nowMillis) &&
		(expiresAt === null || expiresAt > BigInt(grant.nowMillis))
	)
}

export function calculateSessionAccessControlLevel(
	input: CalculateSessionAccessControlLevelInput,
): SessionAccessControlLevel {
	const hasTaskView = input.sessionTaskId ? input.effectiveTaskPermission !== null : false
	const hasTaskEdit = input.sessionTaskId ? input.effectiveTaskPermission === 'edit' : false
	const ownsStandalone = !input.sessionTaskId && input.sessionResourceOwnerUserId === input.actorUserId
	const hasView = input.sessionTaskId ? hasTaskView : ownsStandalone
	const hasOwnerAccess = input.sessionCreatedBy === input.actorUserId && (hasTaskEdit || ownsStandalone)

	if (hasOwnerAccess) return SessionAccessControl.owner

	const activeGrant =
		isMultiplayerPromptingActive(input) && input.multiplayerPromptingUserIds.includes(input.actorUserId)

	if (activeGrant && (hasTaskEdit || !input.sessionTaskId)) return SessionAccessControl.prompt
	if (hasView) return SessionAccessControl.view
	return SessionAccessControl.noAccess
}

export interface SessionAccessRequestInput {
	organizationId: string
	sessionId: string
	actorUserId: string
}

/** Classic-procedure bridge. New Effect procedures should use getSessionAccessControlLevel. */
export async function getSessionAccessControlLevelForClassicProcedure(
	db: PgDatabase<PostgresJsQueryResultHKT>,
	input: SessionAccessRequestInput,
	nowMillis: number,
): Promise<SessionAccessControlLevel> {
	const [row] = await db
		.select({
			createdBy: sessions.created_by,
			resourceOwnerUserId: sessions.resource_owner_user_id,
			taskId: sessions.task_id,
			userIds: sessions.multiplayer_prompting_user_ids,
			startedAt: sessions.multiplayer_prompting_started_at,
			expiresAt: sessions.multiplayer_prompting_expires_at,
			featureEnabled: organizationSettings.multiplayer_prompting_enabled,
		})
		.from(sessions)
		.leftJoin(organizationSettings, eq(organizationSettings.organization_id, sessions.organization_id))
		.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, input.organizationId)))
		.limit(1)

	if (!row) {
		throw new SessionDoesNotExistError({ sessionId: input.sessionId, organizationId: input.organizationId })
	}

	const taskPermission = row.taskId
		? await getTaskWithEffectivePermissions(db, row.taskId, input.actorUserId, input.organizationId)
		: null

	return calculateSessionAccessControlLevel({
		actorUserId: input.actorUserId,
		sessionCreatedBy: row.createdBy,
		sessionResourceOwnerUserId: row.resourceOwnerUserId,
		sessionTaskId: row.taskId,
		multiplayerPromptingEnabledForOrganization: row.featureEnabled ?? false,
		multiplayerPromptingUserIds: row.userIds,
		multiplayerPromptingStartedAt: row.startedAt,
		multiplayerPromptingExpiresAt: row.expiresAt,
		effectiveTaskPermission: taskPermission?.effectivePermission ?? null,
		nowMillis,
	})
}

export interface SessionPromptingAccess {
	accessLevel: SessionAccessControlLevel
	/** True while the session has a live collaborator grant, regardless of who the actor is. */
	multiplayerPromptingActive: boolean
}

export const getSessionPromptingAccess = Effect.fn('session_multiplayer_prompting_auth.get_prompting_access')(
	function* (transaction: PostgresTransaction, input: SessionAccessRequestInput, nowMillis: number) {
		const [row] = yield* transaction.query(
			transaction.client
				.select({
					createdBy: sessions.created_by,
					resourceOwnerUserId: sessions.resource_owner_user_id,
					taskId: sessions.task_id,
					userIds: sessions.multiplayer_prompting_user_ids,
					startedAt: sessions.multiplayer_prompting_started_at,
					expiresAt: sessions.multiplayer_prompting_expires_at,
					featureEnabled: organizationSettings.multiplayer_prompting_enabled,
				})
				.from(sessions)
				.leftJoin(organizationSettings, eq(organizationSettings.organization_id, sessions.organization_id))
				.where(and(eq(sessions.id, input.sessionId), eq(sessions.organization_id, input.organizationId)))
				.limit(1),
		)

		if (!row) {
			return yield* Effect.fail(
				new SessionDoesNotExistError({
					sessionId: input.sessionId,
					organizationId: input.organizationId,
				}),
			)
		}

		const taskId = row.taskId
		const taskPermission = taskId
			? yield* transaction.run(() =>
					getTaskWithEffectivePermissions(
						transaction.client,
						taskId,
						input.actorUserId,
						input.organizationId,
					),
				)
			: null

		const grant: MultiplayerPromptingGrant = {
			multiplayerPromptingEnabledForOrganization: row.featureEnabled ?? false,
			multiplayerPromptingUserIds: row.userIds,
			multiplayerPromptingStartedAt: row.startedAt,
			multiplayerPromptingExpiresAt: row.expiresAt,
			nowMillis,
		}

		return {
			accessLevel: calculateSessionAccessControlLevel({
				...grant,
				actorUserId: input.actorUserId,
				sessionCreatedBy: row.createdBy,
				sessionResourceOwnerUserId: row.resourceOwnerUserId,
				sessionTaskId: row.taskId,
				effectiveTaskPermission: taskPermission?.effectivePermission ?? null,
			}),
			multiplayerPromptingActive: isMultiplayerPromptingActive(grant),
		}
	},
)

export const getSessionAccessControlLevel = Effect.fn('session_multiplayer_prompting_auth.get_access_control_level')(
	function* (transaction: PostgresTransaction, input: SessionAccessRequestInput, nowMillis: number) {
		const { accessLevel } = yield* getSessionPromptingAccess(transaction, input, nowMillis)
		return accessLevel
	},
)
