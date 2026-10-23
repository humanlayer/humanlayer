/**
 * Workflow grouping for the List layout.
 *
 * Grouping delegates placement to the Board's `assignColumn`, so a task's group
 * in Grouped List is by construction the column it occupies on the Board — there
 * is no second copy of the label-precedence rules to drift.
 *
 * Pure: no queries, no React, no collections.
 */

import { assignColumn, type ColumnId, KANBAN_COLUMN_DEFS, type KanbanSessionInput } from '@/lib/kanban/columnEngine'

/** The task shape the grouping needs: an id plus the sessions that place it. */
export interface GroupableTask {
	id: string
	is_draft?: boolean | null
	workflowSessions: KanbanSessionInput[]
}

export interface TaskGroup {
	id: ColumnId
	title: string
	taskIds: string[]
}

/**
 * Group tasks into the five workflow groups, latest phase first.
 *
 * The Board reads left-to-right from Todo to In Review; the List reverses that
 * so the most progressed work leads and Todo / Draft trails.
 *
 * Iterates `KANBAN_COLUMN_DEFS` rather than the groups actually present, so an
 * empty group still appears and the set of headers stays fixed as tasks move.
 * Input order is preserved within each group, which keeps the caller's recency
 * sort intact.
 */
export function groupTasksByWorkflow(tasks: GroupableTask[]): TaskGroup[] {
	const taskIdsByColumn = new Map<ColumnId, string[]>()
	for (const def of KANBAN_COLUMN_DEFS) {
		taskIdsByColumn.set(def.id, [])
	}

	for (const task of tasks) {
		const columnId = assignColumn({ is_draft: task.is_draft ?? false }, task.workflowSessions)
		taskIdsByColumn.get(columnId)?.push(task.id)
	}

	return KANBAN_COLUMN_DEFS.map((def) => ({
		id: def.id,
		title: def.title,
		taskIds: taskIdsByColumn.get(def.id) ?? [],
	})).reverse()
}
