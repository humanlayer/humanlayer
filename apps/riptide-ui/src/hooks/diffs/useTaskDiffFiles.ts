import type { WorkspaceState } from '@humanlayer/schemas/effect/workspace'
import { parseTaskDiffFileRow, type TaskDiffFileRowType } from '@humanlayer/streams/diff'
import { taskDiffDisplayPath } from '@humanlayer/ui/lib/diff-review/task-diff-display-path'
import { useLiveQuery } from '@tanstack/react-db'
import { useMemo } from 'react'

import { useTaskDiffDatabases } from '@/components/diffs/task-diff-context'
import { orderTaskDiffFiles } from '@/hooks/diffs/sort-task-diff-files'
import { useTaskDiffVisibilityStore } from '@/hooks/stores/taskDiffVisibilityStore'

export { orderTaskDiffFiles, rankTaskDiffFilesByRecency } from '@/hooks/diffs/sort-task-diff-files'

export type TaskDiffFilesStatus = 'loading' | 'ready' | 'unavailable'

const EMPTY_ROWS: TaskDiffFileRowType[] = []

/** Project stream rows into the one-file-per-visible-path identity used by the review UI. */
export function uniqueTaskDiffFiles(rows: readonly TaskDiffFileRowType[]): TaskDiffFileRowType[] {
	const latestByPath = new Map<string, TaskDiffFileRowType>()
	for (const row of rows) {
		const path = taskDiffDisplayPath(row)
		const previous = latestByPath.get(path)
		if (
			!previous ||
			row.updatedAt > previous.updatedAt ||
			(row.updatedAt === previous.updatedAt && row.id > previous.id)
		) {
			latestByPath.set(path, row)
		}
	}
	return [...latestByPath.values()]
}

export interface TaskDiffFilesResult {
	rows: TaskDiffFileRowType[]
	status: TaskDiffFilesStatus
	error: Error | null
}

interface TaskDiffEligibilityStatusInput {
	taskId: string | null | undefined
	workspaceId: string | null
	workspaceState: WorkspaceState | null
}

export function isTaskDiffEligible(workspaceId: string | null, workspaceState: WorkspaceState | null): boolean {
	return (
		workspaceId !== null ||
		(workspaceState !== null &&
			workspaceState.repos.length > 0 &&
			workspaceState.repos.every((repo) => Boolean(repo.sourceRef)))
	)
}

export function getTaskDiffEligibilityStatus({
	taskId,
	workspaceId,
	workspaceState,
}: TaskDiffEligibilityStatusInput): TaskDiffFilesStatus {
	if (!taskId || !isTaskDiffEligible(workspaceId, workspaceState)) return 'unavailable'
	return 'ready'
}

/** Reads the task's lightweight file metadata stream when the local workspace is eligible. */
export function useTaskDiffFiles(
	taskId: string | null | undefined,
	organizationId: string | null | undefined,
	workspaceId: string | null,
	workspaceState: WorkspaceState | null,
): TaskDiffFilesResult {
	const eligibilityStatus = getTaskDiffEligibilityStatus({ taskId, workspaceId, workspaceState })
	const { databases, filesStatus, filesError } = useTaskDiffDatabases()
	const fileSort = useTaskDiffVisibilityStore((state) => state.fileSort)
	const fileOrderIds = useTaskDiffVisibilityStore((state) => state.fileOrderIds)
	const filesDatabase = filesStatus === 'ready' ? databases.files : null
	const { data: streamRows } = useLiveQuery(
		(q) => (filesDatabase ? q.from({ files: filesDatabase.collections.files }) : undefined),
		[filesDatabase],
	)
	// Guarded inside the memo, not before it: `parseTaskDiffFileRow` throws on a row the
	// schema no longer matches, and the states below render no files at all. Decoding them
	// anyway would take the whole diff surface down instead of showing its placeholder.
	const ready = eligibilityStatus === 'ready' && Boolean(organizationId) && filesStatus === 'ready'
	const rows = useMemo(
		() =>
			ready
				? orderTaskDiffFiles(
						uniqueTaskDiffFiles((streamRows ?? []).map((row) => parseTaskDiffFileRow(row))),
						fileSort,
						fileOrderIds,
					)
				: EMPTY_ROWS,
		[fileOrderIds, fileSort, ready, streamRows],
	)
	if (eligibilityStatus !== 'ready') return { rows: EMPTY_ROWS, status: eligibilityStatus, error: null }
	if (!organizationId) return { rows: EMPTY_ROWS, status: 'loading', error: null }
	if (filesStatus === 'unavailable') return { rows: EMPTY_ROWS, status: 'unavailable', error: filesError }
	if (filesStatus !== 'ready') return { rows: EMPTY_ROWS, status: 'loading', error: null }
	return { rows, status: 'ready', error: null }
}

export function useCurrentTaskDiffFiles(): TaskDiffFilesResult {
	const { taskId, organizationId, workspaceId, workspaceState } = useTaskDiffDatabases()
	return useTaskDiffFiles(taskId, organizationId, workspaceId, workspaceState)
}
