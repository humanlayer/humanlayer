import { and, eq, max, or, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'

export interface EditableTask {
	id: string
	name: string
	created_at: bigint | null
	updated_at: bigint | null
	default_working_directory: string | null
	resource_owner_user_id: string | null
	/** MAX(session.last_activity_at) if sessions exist, null otherwise */
	latestSessionActivity: bigint | null
}

interface UseEditableTasksOptions {
	/** Maximum number of tasks to return. If undefined, returns all tasks. */
	limit?: number
	/** User ID for ownership and ACL filtering. Required. */
	userId: string | null
}

/**
 * Fetches tasks where the user has edit access (owned OR ACL edit permission).
 *
 * Uses TanStack DB's multi-join pattern:
 * 1. LEFT JOIN tasks with task_user_acl (for user-specific grants)
 * 2. LEFT JOIN tasks with task_organization_acl (for org-wide grants)
 * 3. LEFT JOIN tasks with sessions (for recency sorting)
 * 4. WHERE: archived = false AND (owned OR user ACL edit OR org ACL edit)
 * 5. GROUP BY: Deduplicate rows that match multiple conditions
 * 6. Order by: coalesce(session_activity, task.updated_at) descending
 */
export function useEditableTasks(options: UseEditableTasksOptions) {
	const { limit, userId } = options
	const { tasksCollection, sessionsCollection, taskUserAclsCollection, taskOrganizationAclsCollection } = useSync()

	const { data, isReady } = useLiveQuery(
		(q) => {
			if (!userId) return undefined

			let query = q
				.from({ tasks: tasksCollection })
				.leftJoin({ userAcl: taskUserAclsCollection }, ({ tasks, userAcl }) => eq(tasks.id, userAcl.task_id))
				.leftJoin({ orgAcl: taskOrganizationAclsCollection }, ({ tasks, orgAcl }) =>
					eq(tasks.id, orgAcl.task_id),
				)
				.leftJoin({ sessions: sessionsCollection }, ({ tasks, sessions }) => eq(tasks.id, sessions.task_id))
				.where(({ tasks, userAcl, orgAcl }) =>
					and(
						eq(tasks.archived, false),
						or(
							// Owned by user
							eq(tasks.resource_owner_user_id, userId),
							// User ACL with edit permission
							and(eq(userAcl.subject_user_id, userId), eq(userAcl.permission_level, 'edit')),
							// Org ACL with edit permission (applies to all org members)
							eq(orgAcl.permission_level, 'edit'),
						),
					),
				)
				.select(({ tasks, sessions }) => ({
					id: tasks.id,
					name: tasks.name,
					created_at: tasks.created_at,
					updated_at: tasks.updated_at,
					default_working_directory: tasks.default_working_directory,
					resource_owner_user_id: tasks.resource_owner_user_id,
					latestSessionActivity: max(sessions?.last_activity_at),
				}))
				.groupBy(({ tasks }) => [
					tasks.id,
					tasks.name,
					tasks.created_at,
					tasks.updated_at,
					tasks.default_working_directory,
					tasks.resource_owner_user_id,
				])
				.orderBy(({ tasks }) => tasks.updated_at, 'desc')

			if (limit !== undefined && limit > 0) {
				query = query.limit(limit)
			}

			return query
		},
		[tasksCollection, sessionsCollection, taskUserAclsCollection, taskOrganizationAclsCollection, userId, limit],
	)

	// Sort with 15-second bucketing to stabilize order during parallel execution
	const sortedTasks = useMemo(() => {
		if (!data) return []
		return [...data].sort((a, b) => {
			const tsA = Number(a.latestSessionActivity || a.updated_at)
			const tsB = Number(b.latestSessionActivity || b.updated_at)
			const bucketA = Math.floor(tsA / 15000)
			const bucketB = Math.floor(tsB / 15000)
			if (bucketB !== bucketA) return bucketB - bucketA
			return Number(b.created_at) - Number(a.created_at)
		})
	}, [data])

	return {
		tasks: (sortedTasks ?? []) as EditableTask[],
		isReady,
	}
}
