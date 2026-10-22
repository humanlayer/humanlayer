import { eq, useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { activityMinute } from '@/lib/activitySorting'
import type { KanbanSessionInput } from '@/lib/kanban/columnEngine'
import { isTaskEligible, matchesTaskScope, type TaskScope } from '@/lib/tasks/taskScope'

export interface TaskWithActivity {
	id: string
	name: string
	created_at: bigint | null
	updated_at: bigint | null
	archived: boolean
	is_draft: boolean
	team_id: string | null
	project_id: string | null
	organization_id: string
	default_working_directory: string | null
	resource_owner_user_id: string | null
	/** MAX(session.last_activity_at) if sessions exist, null otherwise */
	latestSessionActivity: bigint | null
	/** Number of sessions linked to this task */
	sessionCount: number
	/**
	 * The minimal session history `assignColumn` needs to place this task in a
	 * workflow group. Same inputs the Board uses, so Grouped List and Board agree.
	 */
	workflowSessions: WorkflowSessionInput[]
}

/** The three fields `assignColumn` reads. Structurally a `KanbanSessionInput`. */
type WorkflowSessionInput = Pick<KanbanSessionInput, 'archived' | 'labels' | 'last_activity_at'>

interface UseTasksByRecencyOptions {
	/** Maximum number of tasks to return. If undefined, returns all tasks. */
	limit?: number
	/** Filter by archived status. Defaults to false (non-archived). */
	archived?: boolean
	/**
	 * If true, only return tasks owned by the current user (resource_owner_user_id === userId).
	 * Requires userId to be provided. When false, includes tasks shared via ACL from other users.
	 */
	ownedOnly?: boolean
	/** User ID for ownership filtering. Required when ownedOnly is true. */
	userId?: string | null
	/**
	 * When set, returns owned tasks UNION shared tasks where any session was created by this user.
	 * Takes precedence over ownedOnly when both are set.
	 */
	includeSessionsCreatedBy?: string | null
	/**
	 * The desktop Tasks scope. When set, the shared `taskScope` eligibility and
	 * scope predicates replace `ownedOnly` / `includeSessionsCreatedBy`, so List
	 * shows exactly what Board and the Tasks badge show.
	 */
	scope?: TaskScope
}

/**
 * Fetches tasks sorted by their most recent activity.
 *
 * Tasks and sessions are subscribed to separately and joined in a memo rather
 * than through an indexed live-query join: session rows change constantly, and
 * the query-pipeline join re-runs the whole task projection on every one of
 * those writes.
 *
 * The join derives the latest session activity and the session count, then
 * sorts in 15-second activity buckets with task creation time as the tiebreak.
 */
export function useTasksByRecency(options: UseTasksByRecencyOptions = {}) {
	const {
		limit,
		archived = false,
		ownedOnly = false,
		userId = null,
		includeSessionsCreatedBy = null,
		scope,
	} = options
	const { tasksCollection, sessionsCollection } = useSync()
	// TODO: This org-wide session subscription rebuilds the session index and all
	// derived task rows on each session write. For large orgs, narrow it to active
	// task IDs and preserve unchanged row objects so row memo can skip their renders.

	// A caller that asked for owned-only tasks without a user id wants nothing;
	// keep the live query disabled rather than briefly leaking the whole org.
	const isDisabled = ownedOnly && !userId && !includeSessionsCreatedBy && !scope

	const { data: taskRows, isReady: tasksReady } = useLiveQuery(
		(q) => {
			if (isDisabled) return undefined
			return q
				.from({ tasks: tasksCollection })
				.where(({ tasks }) => eq(tasks.archived, archived))
				.select(({ tasks }) => ({
					id: tasks.id,
					name: tasks.name,
					created_at: tasks.created_at,
					updated_at: tasks.updated_at,
					archived: tasks.archived,
					is_draft: tasks.is_draft,
					team_id: tasks.team_id,
					project_id: tasks.project_id,
					organization_id: tasks.organization_id,
					default_working_directory: tasks.default_working_directory,
					resource_owner_user_id: tasks.resource_owner_user_id,
				}))
		},
		[tasksCollection, archived, isDisabled],
	)

	const { data: sessionRows, isReady: sessionsReady } = useLiveQuery(
		(q) => {
			if (isDisabled) return undefined
			// Minimal projection: the scope predicate needs `created_by`, and
			// `assignColumn` needs archived/labels/last_activity_at. Nothing else.
			return q.from({ sessions: sessionsCollection }).select(({ sessions }) => ({
				task_id: sessions.task_id,
				created_by: sessions.created_by,
				last_activity_at: sessions.last_activity_at,
				archived: sessions.archived,
				labels: sessions.labels,
			}))
		},
		[sessionsCollection, isDisabled],
	)

	const sessionsByTaskId = useMemo(() => {
		const map = new Map<string, Array<WorkflowSessionInput & { created_by: string | null }>>()
		for (const session of sessionRows ?? []) {
			if (!session.task_id) continue
			const bucket = map.get(session.task_id)
			const entry = {
				created_by: session.created_by,
				last_activity_at: session.last_activity_at,
				archived: session.archived,
				labels: session.labels,
			}
			if (bucket) bucket.push(entry)
			else map.set(session.task_id, [entry])
		}
		return map
	}, [sessionRows])

	const sortedTasks = useMemo<TaskWithActivity[]>(() => {
		if (!taskRows) return []

		const rows: TaskWithActivity[] = []
		for (const task of taskRows) {
			const sessions = sessionsByTaskId.get(task.id) ?? []

			if (scope) {
				if (!isTaskEligible(task, scope)) continue
				if (
					!matchesTaskScope(
						task,
						sessions.map((session) => session.created_by),
						scope,
					)
				)
					continue
			} else {
				// Drafts live in the Drafts tab, but archived drafts stay visible in the
				// archive so users can see what they discarded.
				if (!archived && task.is_draft) continue

				if (includeSessionsCreatedBy) {
					const isMine =
						task.resource_owner_user_id === includeSessionsCreatedBy ||
						sessions.some((session) => session.created_by === includeSessionsCreatedBy)
					if (!isMine) continue
				} else if (ownedOnly && userId) {
					if (task.resource_owner_user_id !== userId) continue
				}
			}

			let latestSessionActivity: bigint | null = null
			for (const session of sessions) {
				const activity = session.last_activity_at
				if (activity === null || activity === undefined) continue
				if (latestSessionActivity === null || activity > latestSessionActivity) {
					latestSessionActivity = activity
				}
			}

			rows.push({ ...task, latestSessionActivity, sessionCount: sessions.length, workflowSessions: sessions })
		}

		// Activity-minute bucketing stabilizes order during parallel execution.
		rows.sort((a, b) => {
			const minuteA = activityMinute(a.latestSessionActivity ?? a.updated_at ?? 0)
			const minuteB = activityMinute(b.latestSessionActivity ?? b.updated_at ?? 0)
			if (minuteB !== minuteA) return minuteB - minuteA
			return Number(b.created_at) - Number(a.created_at)
		})

		return limit !== undefined && limit > 0 ? rows.slice(0, limit) : rows
	}, [taskRows, sessionsByTaskId, scope, archived, ownedOnly, userId, includeSessionsCreatedBy, limit])

	return {
		// Both subscriptions gate readiness. Reporting ready on tasks alone would
		// briefly show every task with no sessions — zero counts, stale recency,
		// and, in Grouped List, every row collapsed into Todo / Draft.
		isReady: tasksReady && sessionsReady,
		tasks: sortedTasks,
	}
}
