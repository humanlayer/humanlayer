import { taskOrganizationAcl } from '@humanlayer/db/tables/task-organization-acl'
import { type AclPermissionLevel, taskUserAcl } from '@humanlayer/db/tables/task-user-acl'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq, inArray, or } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

export type TaskWithAuth = {
	id: string
	slug: string | null
	resource_owner_user_id: string | null
	organization_id: string
	default_working_directory: string | null
	auto_advance_questions_to_research: boolean
	auto_advance_research_to_design: boolean
	auto_advance_plan_to_worktree: boolean
	auto_advance_worktree_to_implementation: boolean
	auto_advance_implementation_to_pr: boolean
	ticket_provider: typeof tasks.$inferSelect.ticket_provider
	github_connection_id: string | null
	ticket_repository_id: string | null
}

export type TaskWithEffectivePermissions = TaskWithAuth & {
	effectivePermission: AclPermissionLevel
}

/** Permission hierarchy: edit > comment > read */
const PERMISSION_RANK: Record<AclPermissionLevel, number> = {
	read: 1,
	comment: 2,
	edit: 3,
}

function maxPermission(a: AclPermissionLevel | null, b: AclPermissionLevel | null): AclPermissionLevel | null {
	if (!a) return b
	if (!b) return a
	return PERMISSION_RANK[a] >= PERMISSION_RANK[b] ? a : b
}

/**
 * Lookup task and verify access via ownership OR ACL.
 * Returns null if task doesn't exist or user lacks access.
 *
 * @param tx - Drizzle transaction object
 * @param taskId - Task ID to lookup
 * @param userId - User ID making the request
 * @param organizationId - Organization ID for the request
 * @returns Task data if access granted, null otherwise
 */
export async function maybeGetTaskWithAuthCheck(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	taskId: string,
	userId: string,
	organizationId: string,
): Promise<TaskWithAuth | null> {
	const [task] = await tx
		.select({
			id: tasks.id,
			slug: tasks.slug,
			resource_owner_user_id: tasks.resource_owner_user_id,
			organization_id: tasks.organization_id,
			default_working_directory: tasks.default_working_directory,
			auto_advance_questions_to_research: tasks.auto_advance_questions_to_research,
			auto_advance_research_to_design: tasks.auto_advance_research_to_design,
			auto_advance_plan_to_worktree: tasks.auto_advance_plan_to_worktree,
			auto_advance_worktree_to_implementation: tasks.auto_advance_worktree_to_implementation,
			auto_advance_implementation_to_pr: tasks.auto_advance_implementation_to_pr,
			ticket_provider: tasks.ticket_provider,
			github_connection_id: tasks.github_connection_id,
			ticket_repository_id: tasks.ticket_repository_id,
		})
		.from(tasks)
		.where(
			and(
				eq(tasks.id, taskId),
				eq(tasks.organization_id, organizationId),
				or(
					eq(tasks.resource_owner_user_id, userId),
					inArray(
						tasks.id,
						tx
							.select({ task_id: taskUserAcl.task_id })
							.from(taskUserAcl)
							.where(
								and(
									eq(taskUserAcl.subject_user_id, userId),
									eq(taskUserAcl.organization_id, organizationId),
								),
							),
					),
					inArray(
						tasks.id,
						tx
							.select({ task_id: taskOrganizationAcl.task_id })
							.from(taskOrganizationAcl)
							.where(eq(taskOrganizationAcl.organization_id, organizationId)),
					),
				),
			),
		)
		.limit(1)

	return task ?? null
}

/**
 * Lookup task and return it with the user's effective permission level.
 * Returns null if task doesn't exist, wrong org, or user has no access.
 *
 * Effective permission is the highest of:
 * - 'edit' if user is owner (owner always has edit)
 * - permission_level from task_user_acl if entry exists
 * - permission_level from task_organization_acl if entry exists
 *
 * @param tx - Drizzle transaction object
 * @param taskId - Task ID to lookup
 * @param userId - User ID making the request
 * @param organizationId - Organization ID for the request
 * @returns Task with effective permission, or null if no access
 */
export async function getTaskWithEffectivePermissions(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	taskId: string,
	userId: string,
	organizationId: string,
	options?: { lockForUpdate?: boolean },
): Promise<TaskWithEffectivePermissions | null> {
	// First get the task and verify org
	const taskQuery = tx
		.select({
			id: tasks.id,
			slug: tasks.slug,
			resource_owner_user_id: tasks.resource_owner_user_id,
			organization_id: tasks.organization_id,
			default_working_directory: tasks.default_working_directory,
			auto_advance_questions_to_research: tasks.auto_advance_questions_to_research,
			auto_advance_research_to_design: tasks.auto_advance_research_to_design,
			auto_advance_plan_to_worktree: tasks.auto_advance_plan_to_worktree,
			auto_advance_worktree_to_implementation: tasks.auto_advance_worktree_to_implementation,
			auto_advance_implementation_to_pr: tasks.auto_advance_implementation_to_pr,
			ticket_provider: tasks.ticket_provider,
			github_connection_id: tasks.github_connection_id,
			ticket_repository_id: tasks.ticket_repository_id,
		})
		.from(tasks)
		.where(and(eq(tasks.id, taskId), eq(tasks.organization_id, organizationId)))
		.limit(1)
	const [task] = await (options?.lockForUpdate ? taskQuery.for('no key update') : taskQuery)

	if (!task) return null

	// Check if user is owner - owner always has edit
	const isOwner = task.resource_owner_user_id === userId
	if (isOwner) {
		return { ...task, effectivePermission: 'edit' }
	}

	// Get user ACL permission if exists
	const [userAcl] = await tx
		.select({ permission_level: taskUserAcl.permission_level })
		.from(taskUserAcl)
		.where(
			and(
				eq(taskUserAcl.task_id, taskId),
				eq(taskUserAcl.subject_user_id, userId),
				eq(taskUserAcl.organization_id, organizationId),
			),
		)
		.limit(1)

	// Get org ACL permission if exists
	const [orgAcl] = await tx
		.select({ permission_level: taskOrganizationAcl.permission_level })
		.from(taskOrganizationAcl)
		.where(and(eq(taskOrganizationAcl.task_id, taskId), eq(taskOrganizationAcl.organization_id, organizationId)))
		.limit(1)

	// Compute effective permission as max of user ACL and org ACL
	const userPerm = userAcl?.permission_level ?? null
	const orgPerm = orgAcl?.permission_level ?? null
	const effectivePermission = maxPermission(userPerm, orgPerm)

	// If no permission from any source, user has no access
	if (!effectivePermission) return null

	return { ...task, effectivePermission }
}

export type TaskWriteCheckResult =
	| { ok: true; task: TaskWithAuth }
	| { ok: false; reason: 'not_found' }
	| { ok: false; reason: 'permission_denied' }

/**
 * Check if user has edit permission to a task.
 * Returns a discriminated union for type-safe error handling at the procedure level.
 *
 * @param tx - Drizzle transaction object
 * @param taskId - Task ID to lookup
 * @param userId - User ID making the request
 * @param organizationId - Organization ID for the request
 * @returns Result object indicating success with task data, or failure with reason
 */
export async function checkTaskWritePermission(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	taskId: string,
	userId: string,
	organizationId: string,
): Promise<TaskWriteCheckResult> {
	const task = await getTaskWithEffectivePermissions(tx, taskId, userId, organizationId, {
		lockForUpdate: true,
	})
	if (!task) {
		return { ok: false, reason: 'not_found' }
	}
	if (task.effectivePermission !== 'edit') {
		return { ok: false, reason: 'permission_denied' }
	}
	return { ok: true, task }
}

/**
 * Check if user has task-level edit permission for a session's parent task.
 * - If session has a task → user must have edit permission on task
 * - If session has no task → user must be the resource_owner_user_id
 *
 * Used by daemon-side callers (already gated by host_id match).
 * API-side callers should use canWriteSession which also requires created_by.
 */
export async function canWriteTaskForSession(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	session: { task_id: string | null; resource_owner_user_id: string },
	userId: string,
	organizationId: string,
): Promise<boolean> {
	if (session.task_id) {
		const task = await getTaskWithEffectivePermissions(tx, session.task_id, userId, organizationId)
		return task?.effectivePermission === 'edit'
	}
	return session.resource_owner_user_id === userId
}

/**
 * Check if user can write to a session.
 * User must be the session creator AND have task-level edit access (or own standalone session).
 */
export async function canWriteSession(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	session: { task_id: string | null; resource_owner_user_id: string; created_by: string },
	userId: string,
	organizationId: string,
): Promise<boolean> {
	if (session.created_by !== userId) {
		return false
	}
	return canWriteTaskForSession(tx, session, userId, organizationId)
}

export type SessionWriteCheckResult =
	| { ok: true }
	| { ok: false; reason: 'not_found' }
	| { ok: false; reason: 'permission_denied' }

/**
 * Check if user can write to a session, distinguishing "no access" from "no write permission".
 * Returns a discriminated union for type-safe 404-vs-403 error handling at the procedure level.
 *
 * - 'not_found': user has no read access at all (return 404 to hide existence)
 * - 'permission_denied': user can read but lacks write permission (return 403)
 * - ok: user has write permission
 *
 * Performs a single task permission lookup instead of separate read + write checks.
 */
export async function checkSessionWritePermission(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	session: { task_id: string | null; resource_owner_user_id: string; created_by: string },
	userId: string,
	organizationId: string,
): Promise<SessionWriteCheckResult> {
	// If session has no task, access is based on resource ownership
	if (!session.task_id) {
		if (session.resource_owner_user_id === userId && session.created_by === userId) {
			return { ok: true }
		}
		if (session.resource_owner_user_id !== userId) {
			return { ok: false, reason: 'not_found' }
		}
		// User owns the resource but is not the session creator
		return { ok: false, reason: 'permission_denied' }
	}

	// Single query to get effective permission level on the parent task
	const task = await getTaskWithEffectivePermissions(tx, session.task_id, userId, organizationId)

	// No access at all → hide existence
	if (!task) {
		return { ok: false, reason: 'not_found' }
	}

	// Has read access but not edit, or not the session creator → permission denied
	if (task.effectivePermission !== 'edit' || session.created_by !== userId) {
		return { ok: false, reason: 'permission_denied' }
	}

	return { ok: true }
}

export type TaskReadCheckResult = { ok: true; task: TaskWithAuth } | { ok: false; reason: 'not_found' }

/**
 * Check if user can read a task (via ownership or ACL).
 * Returns task if accessible, or 'not_found' if no access.
 */
export async function checkTaskReadPermission(
	tx: PgDatabase<PostgresJsQueryResultHKT>,
	taskId: string,
	userId: string,
	organizationId: string,
): Promise<TaskReadCheckResult> {
	const task = await maybeGetTaskWithAuthCheck(tx, taskId, userId, organizationId)
	if (!task) {
		return { ok: false, reason: 'not_found' }
	}
	return { ok: true, task }
}
