/**
 * The shared task eligibility + scope contract used by the Tasks surface.
 *
 * Board, List, and the Tasks tab badge all run these two predicates over the
 * same organization-scoped rows, so the three surfaces can never disagree about
 * which tasks are visible or how many there are.
 *
 * Pure: no queries, no React, no collections.
 */

export type TaskViewMode = 'everything' | 'mine'

export interface TaskScope {
	/** Everything = every eligible task (optionally narrowed by `selectedUserIds`); Mine = the current user's. */
	mode: TaskViewMode
	/** Owner ids selected in the Everything picker. Ignored under Mine. */
	selectedUserIds: string[]
	/** The authenticated user, or null before auth resolves. */
	currentUserId: string | null
}

interface EligibilityTask {
	archived: boolean
	is_draft?: boolean | null
	resource_owner_user_id: string | null
}

interface ScopeTask {
	resource_owner_user_id: string | null
}

/**
 * Active non-draft, or an active draft owned by the current user.
 *
 * Drafts are private: a teammate's draft is never eligible, in any mode, even
 * when that teammate is explicitly selected in the Everything picker.
 */
export function isTaskEligible(task: EligibilityTask, scope: TaskScope): boolean {
	if (task.archived) return false
	if (!task.is_draft) return true
	return scope.currentUserId !== null && task.resource_owner_user_id === scope.currentUserId
}

/** The normal Tasks board shows launched tasks only; drafts keep their dedicated surfaces. */
export function isTaskEligibleForBoard(task: EligibilityTask, scope: TaskScope): boolean {
	return !task.is_draft && isTaskEligible(task, scope)
}

/**
 * Everything (optionally narrowed by owners) or Mine (owner, or created a session).
 *
 * `sessionCreatorIds` are the `created_by` values from the task's full session history;
 * pass an empty iterable when the task has none.
 */
export function matchesTaskScope(
	task: ScopeTask,
	sessionCreatorIds: Iterable<string | null>,
	scope: TaskScope,
): boolean {
	if (scope.mode === 'mine') {
		const userId = scope.currentUserId
		if (!userId) return false
		if (task.resource_owner_user_id === userId) return true
		for (const creatorId of sessionCreatorIds) {
			if (creatorId === userId) return true
		}
		return false
	}

	if (scope.selectedUserIds.length === 0) return true
	return task.resource_owner_user_id !== null && scope.selectedUserIds.includes(task.resource_owner_user_id)
}
