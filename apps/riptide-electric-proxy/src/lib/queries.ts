import { effectivePublicPermission } from '@humanlayer/db/artifact-public-permission'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizationSettings } from '@humanlayer/db/tables/organization-settings'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import type { AclPermissionLevel } from '@humanlayer/db/tables/task-user-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { Sentry } from './effect/sentry.service'
import { logger } from './logger'

export type DbClient = PostgresJsDatabase<Record<string, never>>

type SessionAccessControlLevel = 'no_access' | 'view' | 'prompt' | 'owner'

const SESSION_ACCESS_CONTROL_RANK: Record<SessionAccessControlLevel, number> = {
	no_access: 0,
	view: 1,
	prompt: 2,
	owner: 3,
}

const TASK_PERMISSION_RANK: Record<AclPermissionLevel, number> = {
	read: 1,
	comment: 2,
	edit: 3,
}

function maxTaskPermission(a: AclPermissionLevel | null, b: AclPermissionLevel | null): AclPermissionLevel | null {
	if (!a) return b
	if (!b) return a
	return TASK_PERMISSION_RANK[a] >= TASK_PERMISSION_RANK[b] ? a : b
}

async function getEffectiveTaskPermission(
	db: DbClient,
	taskId: string,
	userId: string,
	organizationId: string,
): Promise<AclPermissionLevel | null> {
	const [task] = await db
		.select({ resourceOwnerUserId: tasks.resource_owner_user_id })
		.from(tasks)
		.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
		.limit(1)

	if (!task) return null
	if (task.resourceOwnerUserId === userId) return 'edit'

	const [userAcl] = await db
		.select({ permissionLevel: taskUserAcl.permission_level })
		.from(taskUserAcl)
		.where(
			and(
				eq(taskUserAcl.task_id, taskId),
				eq(taskUserAcl.subject_user_id, userId),
				eq(taskUserAcl.organization_id, organizationId),
			),
		)
		.limit(1)

	const [organizationAcl] = await db
		.select({ permissionLevel: taskOrganizationAcl.permission_level })
		.from(taskOrganizationAcl)
		.where(and(eq(taskOrganizationAcl.task_id, taskId), eq(taskOrganizationAcl.organization_id, organizationId)))
		.limit(1)

	return maxTaskPermission(userAcl?.permissionLevel ?? null, organizationAcl?.permissionLevel ?? null)
}

/**
 * Duplicates the canonical authorization rules in
 * apps/riptide-api/src/lib/session-multiplayer-prompting-auth.ts.
 * Keep both implementations synchronized when session access rules change.
 */
function calculateSessionAccessControlLevel(input: {
	actorUserId: string
	sessionCreatedBy: string
	sessionResourceOwnerUserId: string
	sessionTaskId: string | null
	multiplayerPromptingEnabledForOrganization: boolean
	multiplayerPromptingUserIds: string[]
	multiplayerPromptingStartedAt: bigint | null
	multiplayerPromptingExpiresAt: bigint | null
	effectiveTaskPermission: AclPermissionLevel | null
	nowMillis: number
}): SessionAccessControlLevel {
	const hasTaskView = input.sessionTaskId ? input.effectiveTaskPermission !== null : false
	const hasTaskEdit = input.sessionTaskId ? input.effectiveTaskPermission === 'edit' : false
	const ownsStandalone = !input.sessionTaskId && input.sessionResourceOwnerUserId === input.actorUserId
	const hasView = input.sessionTaskId ? hasTaskView : ownsStandalone
	const hasOwnerAccess = input.sessionCreatedBy === input.actorUserId && (hasTaskEdit || ownsStandalone)

	if (hasOwnerAccess) return 'owner'

	const startedAt = input.multiplayerPromptingStartedAt
	const expiresAt = input.multiplayerPromptingExpiresAt
	const activeGrant =
		input.multiplayerPromptingEnabledForOrganization &&
		input.multiplayerPromptingUserIds.includes(input.actorUserId) &&
		startedAt !== null &&
		startedAt <= BigInt(input.nowMillis) &&
		(expiresAt === null || expiresAt > BigInt(input.nowMillis))

	if (activeGrant && (hasTaskEdit || !input.sessionTaskId)) return 'prompt'
	if (hasView) return 'view'
	return 'no_access'
}

/** Loads a share-key match together with its org's public link policy. */
async function selectSharedArtifact(db: DbClient, artifactId: string, shareKey: string) {
	const [artifact] = await db
		.select({
			share_enabled: artifacts.share_enabled,
			public_permission: artifacts.public_permission,
			public_links_allowed: organizationSettings.enable_creating_publicly_shareable_links,
		})
		.from(artifacts)
		.leftJoin(organizationSettings, eq(organizationSettings.organization_id, artifacts.organization_id))
		.where(and(eq(artifacts.id, artifactId), eq(artifacts.share_key, shareKey)))
	if (!artifact) return undefined
	return {
		row: artifact,
		org: { publicLinksAllowed: artifact.public_links_allowed ?? true },
	}
}

/**
 * Check if a shared artifact exists and has sharing enabled with the given key.
 * Returns true if the artifact can be accessed via this share key.
 */
export async function isSharedArtifactAccessible(db: DbClient, artifactId: string, shareKey: string): Promise<boolean> {
	try {
		const artifact = await selectSharedArtifact(db, artifactId, shareKey)
		return artifact !== undefined && effectivePublicPermission(artifact.row, artifact.org) !== 'off'
	} catch (error) {
		logger.error(`Unable to validate shared artifact ${artifactId}`, error)
		Sentry.captureException(error, {
			tags: { error_type: 'shared_artifact_query', artifact_id: artifactId },
		})
		return false
	}
}

/** Comment synchronization requires the stronger public `comment` capability. */
export async function isSharedArtifactCommentAccessible(
	db: DbClient,
	artifactId: string,
	shareKey: string,
): Promise<boolean> {
	try {
		const artifact = await selectSharedArtifact(db, artifactId, shareKey)
		return artifact !== undefined && effectivePublicPermission(artifact.row, artifact.org) === 'comment'
	} catch (error) {
		logger.error(`Unable to validate shared artifact comment access ${artifactId}`, error)
		Sentry.captureException(error, {
			tags: { error_type: 'shared_artifact_comment_query', artifact_id: artifactId },
		})
		return false
	}
}

/**
 * Check if a user should be allowed to read a given session.
 * Accepts db as a parameter for testability.
 */
async function getSessionCapabilities(
	db: DbClient,
	sessionId: string,
	userId: string,
	organizationId: string,
): Promise<{ organizationMember: boolean; accessLevel: SessionAccessControlLevel }> {
	try {
		const [session] = await db
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
			.where(and(eq(sessions.organization_id, organizationId), eq(sessions.id, sessionId)))
			.limit(1)

		if (!session) return { organizationMember: false, accessLevel: 'no_access' }

		const effectiveTaskPermission = session.taskId
			? await getEffectiveTaskPermission(db, session.taskId, userId, organizationId)
			: null
		const accessLevel = calculateSessionAccessControlLevel({
			actorUserId: userId,
			sessionCreatedBy: session.createdBy,
			sessionResourceOwnerUserId: session.resourceOwnerUserId,
			sessionTaskId: session.taskId,
			multiplayerPromptingEnabledForOrganization: session.featureEnabled ?? false,
			multiplayerPromptingUserIds: session.userIds,
			multiplayerPromptingStartedAt: session.startedAt,
			multiplayerPromptingExpiresAt: session.expiresAt,
			effectiveTaskPermission,
			nowMillis: Date.now(),
		})

		return { organizationMember: true, accessLevel }
	} catch (error) {
		logger.error(`Unable to query session ${sessionId} for user ${userId} with org ${organizationId}`, error)
		Sentry.captureException(error, {
			tags: { error_type: 'session_access_query', session_id: sessionId },
		})
	}
	return { organizationMember: false, accessLevel: 'no_access' }
}

export async function canReadSession(
	db: DbClient,
	sessionId: string,
	userId: string,
	organizationId: string,
): Promise<boolean> {
	const capability = await getSessionCapabilities(db, sessionId, userId, organizationId)
	return SESSION_ACCESS_CONTROL_RANK[capability.accessLevel] >= SESSION_ACCESS_CONTROL_RANK.view
}

/** Membership comes from authenticated organization context, matched against the stored session organization. */
export async function getResponseEditorAccess(
	db: DbClient,
	input: { sessionId: string; userId: string; organizationId: string },
) {
	const capability = await getSessionCapabilities(db, input.sessionId, input.userId, input.organizationId)
	return {
		organizationMember: capability.organizationMember,
		canPrompt: SESSION_ACCESS_CONTROL_RANK[capability.accessLevel] >= SESSION_ACCESS_CONTROL_RANK.prompt,
	}
}
