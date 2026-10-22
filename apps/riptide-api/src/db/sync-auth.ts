/**
 * Sync authorization WHERE builders.
 *
 * These functions return Drizzle SQL conditions that parallel the electric proxy's
 * where-builder.ts — same authorization logic, expressed in Drizzle ORM form rather
 * than raw SQL fragments.
 *
 * Each sync handler ANDs the auth condition from this module with client-supplied
 * where expressions from buildDrizzleWhereFromExpression.
 *
 * IMPORTANT: For tables with a nullable `task_id` column (sessions, conversation_events,
 * approvals, artifacts), each ACL subquery branch includes an explicit isNotNull(table.task_id)
 * guard. This matches the electric proxy behavior and prevents SQL NULL semantics from
 * silently dropping rows (NULL IN (...) evaluates to NULL/false rather than false, which
 * means a row with task_id IS NULL that should be visible via resource_owner_user_id would
 * be silently excluded if the isNotNull guard is absent).
 */

import { agentSlashCommands } from '@humanlayer/db/tables/agent-slash-commands'
import { approvals } from '@humanlayer/db/tables/approvals'
import { artifactComments } from '@humanlayer/db/tables/artifact-comments'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { diffComments } from '@humanlayer/db/tables/diff-comments'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { providerLoginRequests } from '@humanlayer/db/tables/provider-login-requests'
import { queuedMessages } from '@humanlayer/db/tables/queued-messages'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { taskWorkspaceSetupForHost } from '@humanlayer/db/tables/task-workspace-setup-for-host'
import { tasks } from '@humanlayer/db/tables/tasks'
import * as Sentry from '@sentry/node'
import { and, eq, inArray, isNotNull, or, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

type SyncAuthParams = {
	organizationId: string
	userId: string
}

type OrganizationId = (typeof organizations.$inferSelect)['id']

type OrganizationScopedTable = {
	organization_id: AnyPgColumn<{ data: OrganizationId }>
}

function buildOrgScopedWhere(table: OrganizationScopedTable): (auth: SyncAuthParams) => SQL {
	return (auth) => eq(table.organization_id, auth.organizationId) as SQL
}

/**
 * Build a Drizzle SQL WHERE condition for the sessions sync route.
 *
 * Parallels buildWhereFragmentWithAcl(sessions, auth) in the electric proxy.
 * Visibility rules:
 * - session.organization_id must equal auth.organizationId
 * - AND one of:
 *   - session.resource_owner_user_id = auth.userId  (user owns the session)
 *   - session.task_id IS NOT NULL AND session.task_id IN (user ACL subquery)
 *   - session.task_id IS NOT NULL AND session.task_id IN (org ACL subquery)
 *
 * @param auth - The authenticated user's organizationId and userId
 * @param db - Drizzle database client (for subquery building)
 * @returns Drizzle SQL WHERE condition
 */
export function buildSessionsSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		// Subquery: task IDs the user has explicit ACL access to
		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		// Subquery: task IDs accessible to the whole organization
		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(sessions.organization_id, organizationId),
			or(
				// Direct ownership — no task_id guard needed
				eq(sessions.resource_owner_user_id, userId),
				// Task-scoped user ACL — guard against NULL task_id
				and(isNotNull(sessions.task_id), inArray(sessions.task_id, userAclSubquery)),
				// Task-scoped org ACL — guard against NULL task_id
				and(isNotNull(sessions.task_id), inArray(sessions.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'sessions', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildSessionsSyncWhereV2 = buildOrgScopedWhere(sessions)

/**
 * Build a Drizzle SQL WHERE condition for the tasks sync route.
 *
 * Parallels buildWhereFragmentForTasks(auth) in the electric proxy.
 * Visibility rules:
 * - task.organization_id must equal auth.organizationId
 * - AND one of:
 *   - task.resource_owner_user_id = auth.userId  (user owns the task)
 *   - task.id IN (user ACL subquery)             (explicit user-level ACL)
 *   - task.id IN (org ACL subquery)              (organization-level ACL)
 *
 * NOTE: Unlike sessions/conversation_events/approvals, tasks use tasks.id
 * (not task_id) for the ACL subquery. No isNotNull guard is needed because
 * tasks.id is always non-null (it's the primary key).
 *
 * @param auth - The authenticated user's organizationId and userId
 * @param db - Drizzle database client (for subquery building)
 * @returns Drizzle SQL WHERE condition
 */
/**
 * Build a Drizzle SQL WHERE condition for the conversation events sync route.
 *
 * Parallels buildWhereFragmentWithAcl(conversationEvents, auth) in the electric proxy.
 * Same visibility pattern as sessions — nullable task_id requires isNotNull guards.
 */
export function buildConversationEventsSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(conversationEvents.organization_id, organizationId),
			or(
				eq(conversationEvents.resource_owner_user_id, userId),
				and(isNotNull(conversationEvents.task_id), inArray(conversationEvents.task_id, userAclSubquery)),
				and(isNotNull(conversationEvents.task_id), inArray(conversationEvents.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'conversation_events', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildConversationEventsSyncWhereV2 = buildOrgScopedWhere(conversationEvents)

export function buildTasksSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		// Subquery: task IDs the user has explicit ACL access to
		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		// Subquery: task IDs accessible to the whole organization
		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(tasks.organization_id, organizationId),
			or(
				// Direct ownership
				eq(tasks.resource_owner_user_id, userId),
				// Task-scoped user ACL — tasks.id is the PK, never null, no guard needed
				inArray(tasks.id, userAclSubquery),
				// Task-scoped org ACL — tasks.id is the PK, never null, no guard needed
				inArray(tasks.id, orgAclSubquery),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'tasks', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildTasksSyncWhereV2 = buildOrgScopedWhere(tasks)

/**
 * Build a Drizzle SQL WHERE condition for the approvals sync route.
 *
 * Parallels buildWhereFragmentWithAcl(approvals, auth) in the electric proxy.
 * Same visibility pattern as sessions — nullable task_id requires isNotNull guards.
 */
export function buildApprovalsSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(approvals.organization_id, organizationId),
			or(
				eq(approvals.resource_owner_user_id, userId),
				and(isNotNull(approvals.task_id), inArray(approvals.task_id, userAclSubquery)),
				and(isNotNull(approvals.task_id), inArray(approvals.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'approvals', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildApprovalsSyncWhereV2 = buildOrgScopedWhere(approvals)

/**
 * Build a Drizzle SQL WHERE condition for the artifacts sync route (full content).
 *
 * Parallels buildWhereFragmentWithAcl(artifacts, auth) in the electric proxy.
 * Same visibility pattern as sessions — nullable task_id requires isNotNull guards.
 */
export function buildArtifactsSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(artifacts.organization_id, organizationId),
			or(
				eq(artifacts.resource_owner_user_id, userId),
				and(isNotNull(artifacts.task_id), inArray(artifacts.task_id, userAclSubquery)),
				and(isNotNull(artifacts.task_id), inArray(artifacts.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'artifacts', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildArtifactsSyncWhereV2 = buildOrgScopedWhere(artifacts)

/**
 * Build a Drizzle SQL WHERE condition for the online hosts sync route.
 *
 * Simple auth: organization_id = auth.organizationId AND user_id = auth.userId.
 * Parallels buildWhereFragment(onlineHosts, [...]) in the electric proxy.
 */
export function buildOnlineHostsSyncWhere(auth: SyncAuthParams): SQL {
	try {
		const { organizationId, userId } = auth

		return and(eq(onlineHosts.organization_id, organizationId), eq(onlineHosts.user_id, userId)) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'online_hosts', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the task organization ACLs sync route.
 *
 * Simple auth: organization_id = auth.organizationId.
 * All org members can see org ACLs (to determine shared task permission levels).
 * Parallels buildWhereFragment(taskOrganizationAcl, [...]) in the electric proxy.
 */
export function buildTaskOrganizationAclsSyncWhere(auth: SyncAuthParams): SQL {
	try {
		const { organizationId } = auth

		return eq(taskOrganizationAcl.organization_id, organizationId) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'task_organization_acl', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the task user ACLs sync route.
 *
 * Users see ACLs where they are the subject OR the resource owner.
 * Parallels the inline auth logic in the electric proxy server.ts.
 */
export function buildTaskUserAclsSyncWhere(auth: SyncAuthParams): SQL {
	try {
		const { organizationId, userId } = auth

		return and(
			eq(taskUserAcl.organization_id, organizationId),
			or(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.resource_owner_user_id, userId)),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'task_user_acl', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the task user settings sync route.
 *
 * Simple auth: organization_id = auth.organizationId AND user_id = auth.userId.
 * Parallels buildWhereFragment(taskUserSettings, [...]) in the electric proxy.
 */
export function buildTaskUserSettingsSyncWhere(auth: SyncAuthParams): SQL {
	try {
		const { organizationId, userId } = auth

		return and(eq(taskUserSettings.organization_id, organizationId), eq(taskUserSettings.user_id, userId)) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'task_user_settings', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the queued messages sync route.
 *
 * Parallels buildWhereFragmentWithAcl(queuedMessages, auth) in the electric proxy.
 * Same visibility pattern as sessions/conversation_events — nullable task_id requires isNotNull guards.
 */
export function buildQueuedMessagesSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(queuedMessages.organization_id, organizationId),
			or(
				eq(queuedMessages.resource_owner_user_id, userId),
				and(isNotNull(queuedMessages.task_id), inArray(queuedMessages.task_id, userAclSubquery)),
				and(isNotNull(queuedMessages.task_id), inArray(queuedMessages.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: { table: 'queued_messages', organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildQueuedMessagesSyncWhereV2 = buildOrgScopedWhere(queuedMessages)

/**
 * Build a Drizzle SQL WHERE condition for the artifact comments sync route.
 *
 * Parallels buildWhereFragmentWithAcl(artifactComments, auth) in the electric proxy.
 * artifact_comments.task_id is NOT NULL (required column), but isNotNull guards are
 * included for consistency with the approvals pattern.
 *
 * Visibility rules:
 * - comment.organization_id must equal auth.organizationId
 * - AND one of:
 *   - comment.resource_owner_user_id = auth.userId  (user owns the comment)
 *   - comment.task_id IN (user ACL subquery)
 *   - comment.task_id IN (org ACL subquery)
 */
export function buildArtifactCommentsSyncWhere(auth: SyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(artifactComments.organization_id, organizationId),
			or(
				eq(artifactComments.resource_owner_user_id, userId),
				inArray(artifactComments.task_id, userAclSubquery),
				inArray(artifactComments.task_id, orgAclSubquery),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { function: 'buildArtifactCommentsSyncWhere' },
			extra: { organizationId: auth.organizationId, userId: auth.userId },
		})
		throw error
	}
}

export const buildArtifactCommentsSyncWhereV2 = buildOrgScopedWhere(artifactComments)

export const buildDiffCommentsSyncWhereV2 = buildOrgScopedWhere(diffComments)

export const buildTaskOrganizationAclsSyncWhereV2 = buildOrgScopedWhere(taskOrganizationAcl)
export const buildTaskUserAclsSyncWhereV2 = buildOrgScopedWhere(taskUserAcl)
export const buildTaskUserSettingsSyncWhereV2 = buildOrgScopedWhere(taskUserSettings)
export const buildTaskWorkspaceSetupForHostSyncWhereV2 = buildOrgScopedWhere(taskWorkspaceSetupForHost)
export const buildOnlineHostsSyncWhereV2 = buildOrgScopedWhere(onlineHosts)

export function buildAgentSlashCommandsSyncWhereV2(auth: SyncAuthParams): SQL {
	return and(
		eq(agentSlashCommands.organization_id, auth.organizationId),
		eq(agentSlashCommands.user_id, auth.userId),
	) as SQL
}

/** Sign-in requests belong to the user who started them. */
export function buildProviderLoginRequestsSyncWhereV2(auth: SyncAuthParams): SQL {
	return and(
		eq(providerLoginRequests.organization_id, auth.organizationId),
		eq(providerLoginRequests.user_id, auth.userId),
	) as SQL
}

type DaemonSyncAuthParams = SyncAuthParams & {
	hostId: string
}

/**
 * Setup rows are shared with every user in an organization, but daemon reads
 * are additionally limited to the host identity carried by the daemon token.
 */
export function buildDaemonWorkspaceSetupSyncWhere(auth: DaemonSyncAuthParams): SQL {
	return and(
		eq(taskWorkspaceSetupForHost.organization_id, auth.organizationId),
		eq(taskWorkspaceSetupForHost.host_id, auth.hostId),
	) as SQL
}

/**
 * Build a Drizzle SQL WHERE condition for the daemon approvals sync route.
 *
 * Parallels the exact daemon-owner scope in the electric proxy
 * (/v1/daemon/approvals route).
 *
 * hostId is derived from the daemon auth token (not from request input), so there
 * is no IDOR risk — a daemon can only see approvals for its own host.
 *
 * Visibility rules:
 * - approval.organization_id must equal auth.organizationId
 * - approval.host_id must equal auth.hostId (scoped to this daemon's host)
 * - approval.user_id must equal auth.userId (the daemon owner)
 *
 * @param auth - The daemon auth context (organizationId, userId, hostId)
 * @param db - Unused database client retained for call-site compatibility
 * @returns Drizzle SQL WHERE condition
 */
export function buildDaemonApprovalsSyncWhere(auth: DaemonSyncAuthParams, _db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId, hostId } = auth

		return and(
			eq(approvals.organization_id, organizationId),
			eq(approvals.user_id, userId),
			eq(approvals.host_id, hostId),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: {
				table: 'approvals (daemon)',
				organizationId: auth.organizationId,
				userId: auth.userId,
				hostId: auth.hostId,
			},
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the daemon tasks sync route.
 *
 * Same ACL as the UI-facing buildTasksSyncWhere — organization scoping plus
 * resource_owner_user_id or ACL subquery on tasks.id. Tasks are NOT host-scoped,
 * so no host_id filter is applied here (unlike daemon sessions/approvals).
 *
 * The daemon can see all tasks accessible to the user/org it's authenticated as.
 *
 * @param auth - The daemon auth context (organizationId, userId, hostId)
 * @param db - Drizzle database client (for subquery building)
 * @returns Drizzle SQL WHERE condition
 */
export function buildDaemonTasksSyncWhere(auth: DaemonSyncAuthParams, db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId } = auth

		// Subquery: task IDs the user has explicit ACL access to
		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		// Subquery: task IDs accessible to the whole organization
		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(tasks.organization_id, organizationId),
			or(
				// Direct ownership
				eq(tasks.resource_owner_user_id, userId),
				// Task-scoped user ACL — tasks.id is the PK, never null, no guard needed
				inArray(tasks.id, userAclSubquery),
				// Task-scoped org ACL — tasks.id is the PK, never null, no guard needed
				inArray(tasks.id, orgAclSubquery),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: {
				table: 'tasks (daemon)',
				organizationId: auth.organizationId,
				userId: auth.userId,
				hostId: auth.hostId,
			},
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the daemon artifacts sync route.
 *
 * Parallels buildWhereFragmentWithAcl(artifacts, auth, { additionalConditions: [task_id = taskId] })
 * in the electric proxy (/v1/tasks/:taskId/artifacts route).
 *
 * The taskId in the request input scopes results to artifacts for the specified task.
 * The ACL subquery further limits visibility to artifacts the daemon's user/org can access.
 *
 * Visibility rules:
 * - artifact.organization_id must equal auth.organizationId
 * - artifact.task_id must equal input.taskId (scoped to this specific task)
 * - AND one of:
 *   - artifact.resource_owner_user_id = auth.userId
 *   - artifact.task_id IS NOT NULL AND artifact.task_id IN (user ACL subquery)
 *   - artifact.task_id IS NOT NULL AND artifact.task_id IN (org ACL subquery)
 *
 * Note: The task_id = taskId condition already implies task_id IS NOT NULL, but
 * the isNotNull guards in the OR branches are retained for consistency with the
 * electric proxy's pattern and to be explicit about NULL semantics.
 *
 * @param auth - The daemon auth context (organizationId, userId, hostId) plus taskId
 * @param db - Drizzle database client (for subquery building)
 * @returns Drizzle SQL WHERE condition
 */
export function buildDaemonArtifactsSyncWhere(
	auth: DaemonSyncAuthParams & { taskId: string },
	db: PostgresJsDatabase,
): SQL {
	try {
		const { organizationId, userId, taskId } = auth

		// Subquery: task IDs the user has explicit ACL access to
		const userAclSubquery = db
			.select({ task_id: taskUserAcl.task_id })
			.from(taskUserAcl)
			.where(and(eq(taskUserAcl.subject_user_id, userId), eq(taskUserAcl.organization_id, organizationId)))

		// Subquery: task IDs accessible to the whole organization
		const orgAclSubquery = db
			.select({ task_id: taskOrganizationAcl.task_id })
			.from(taskOrganizationAcl)
			.where(eq(taskOrganizationAcl.organization_id, organizationId))

		return and(
			eq(artifacts.organization_id, organizationId),
			eq(artifacts.task_id, taskId),
			or(
				// Direct ownership — no task_id guard needed
				eq(artifacts.resource_owner_user_id, userId),
				// Task-scoped user ACL — guard against NULL task_id
				and(isNotNull(artifacts.task_id), inArray(artifacts.task_id, userAclSubquery)),
				// Task-scoped org ACL — guard against NULL task_id
				and(isNotNull(artifacts.task_id), inArray(artifacts.task_id, orgAclSubquery)),
			),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: {
				table: 'artifacts (daemon)',
				organizationId: auth.organizationId,
				userId: auth.userId,
				taskId: auth.taskId,
			},
		})
		throw error
	}
}

/**
 * Build a Drizzle SQL WHERE condition for the daemon sessions sync route.
 *
 * Parallels the exact daemon-owner scope in the electric proxy
 * (/v1/sessions/:hostId route).
 *
 * Visibility rules:
 * - session.organization_id must equal auth.organizationId
 * - session.host_id must equal auth.hostId (scoped to this daemon's host)
 * - session.created_by must equal auth.userId (the daemon owner)
 *
 * @param auth - The daemon auth context (organizationId, userId, hostId)
 * @param db - Unused database client retained for call-site compatibility
 * @returns Drizzle SQL WHERE condition
 */
export function buildDaemonSessionsSyncWhere(auth: DaemonSyncAuthParams, _db: PostgresJsDatabase): SQL {
	try {
		const { organizationId, userId, hostId } = auth

		return and(
			eq(sessions.organization_id, organizationId),
			eq(sessions.host_id, hostId),
			eq(sessions.created_by, userId),
		) as SQL
	} catch (error) {
		Sentry.captureException(error, {
			tags: { error_type: 'sync_auth' },
			extra: {
				table: 'sessions (daemon)',
				organizationId: auth.organizationId,
				userId: auth.userId,
				hostId: auth.hostId,
			},
		})
		throw error
	}
}
