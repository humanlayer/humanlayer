import { useCallback, useMemo } from 'react'

import {
	type DiffComparison,
	getTaskDiffComparison,
	type TaskDiffCollapsedMark,
	type TaskDiffReviewMark,
	type TaskDiffReviewMarkFile,
	taskDiffFileKey,
	useTaskDiffReviewMarksStore,
} from '@/hooks/stores/taskDiffReviewMarksStore'

const EMPTY_ENTRIES: Record<string, TaskDiffReviewMark> = {}
const EMPTY_COLLAPSED_ENTRIES: Record<string, TaskDiffCollapsedMark> = {}

/** A current file row, enough to find its review marks. */
export interface TaskDiffReviewedFile {
	readonly repoId: string
	readonly path: string
	readonly prevPath?: string
	readonly versionId?: string
}

export interface TaskDiffReviewedState {
	/** fileKey -> the version marked reviewed and the one marked before it. */
	entries: Record<string, TaskDiffReviewMark>
	/** fileKey -> a mark the reader removed, kept for its review history. */
	unmarkedEntries: Record<string, TaskDiffReviewMark>
	/** fileKey -> collapse choice for one version. */
	collapsedEntries: Record<string, TaskDiffCollapsedMark>
	comparison: DiffComparison
	setComparison: (comparison: DiffComparison) => void
	setReviewed: (file: TaskDiffReviewedFile, reviewed: boolean) => void
	setCollapsed: (file: TaskDiffReviewedFile, collapsed: boolean) => void
	reviewActions: {
		markAllReviewed: () => void
		markAllUnreviewed: () => void
		collapseAll: () => void
		expandAll: () => void
		/** Forgets every review mark and expands every current file; keeps the comparison mode. */
		resetReview: () => void
	}
}

function toMarkFile(file: TaskDiffReviewedFile): TaskDiffReviewMarkFile {
	return { fileKey: taskDiffFileKey(file), versionId: file.versionId }
}

export function useTaskDiffReviewedState(
	taskId: string | null,
	files: readonly TaskDiffReviewedFile[],
): TaskDiffReviewedState {
	const entries =
		useTaskDiffReviewMarksStore((state) => (taskId ? state.reviewedByTask[taskId] : undefined)) ?? EMPTY_ENTRIES
	const unmarkedEntries =
		useTaskDiffReviewMarksStore((state) => (taskId ? state.unmarkedByTask[taskId] : undefined)) ?? EMPTY_ENTRIES
	const collapsedEntries =
		useTaskDiffReviewMarksStore((state) => (taskId ? state.collapsedByTask[taskId] : undefined)) ??
		EMPTY_COLLAPSED_ENTRIES
	const comparison = useTaskDiffReviewMarksStore((state) => getTaskDiffComparison(state, taskId))
	const storeSetComparison = useTaskDiffReviewMarksStore((state) => state.setComparison)
	const markReviewed = useTaskDiffReviewMarksStore((state) => state.markReviewed)
	const markUnreviewed = useTaskDiffReviewMarksStore((state) => state.markUnreviewed)
	const storeSetCollapsed = useTaskDiffReviewMarksStore((state) => state.setCollapsed)
	const storeResetReview = useTaskDiffReviewMarksStore((state) => state.resetReview)

	const setComparison = useCallback(
		(next: DiffComparison) => {
			if (taskId) storeSetComparison(taskId, next)
		},
		[storeSetComparison, taskId],
	)
	const setReviewed = useCallback(
		(file: TaskDiffReviewedFile, reviewed: boolean) => {
			if (!taskId) return
			if (reviewed) markReviewed(taskId, [toMarkFile(file)])
			else markUnreviewed(taskId, [toMarkFile(file)])
		},
		[markReviewed, markUnreviewed, taskId],
	)
	const setCollapsed = useCallback(
		(file: TaskDiffReviewedFile, collapsed: boolean) => {
			if (taskId) storeSetCollapsed(taskId, [toMarkFile(file)], collapsed)
		},
		[storeSetCollapsed, taskId],
	)
	const reviewActions = useMemo(() => {
		const markFiles = () => files.map(toMarkFile)
		return {
			markAllReviewed: () => {
				if (taskId) markReviewed(taskId, markFiles())
			},
			markAllUnreviewed: () => {
				if (taskId) markUnreviewed(taskId, markFiles())
			},
			collapseAll: () => {
				if (taskId) storeSetCollapsed(taskId, markFiles(), true)
			},
			expandAll: () => {
				if (taskId) storeSetCollapsed(taskId, markFiles(), false)
			},
			resetReview: () => {
				if (!taskId) return
				storeResetReview(taskId)
				// Expand every current file, generated ones included, so all of them read as needing review.
				storeSetCollapsed(taskId, markFiles(), false)
			},
		}
	}, [files, markReviewed, markUnreviewed, storeResetReview, storeSetCollapsed, taskId])

	return {
		entries,
		unmarkedEntries,
		collapsedEntries,
		comparison,
		setComparison,
		setReviewed,
		setCollapsed,
		reviewActions,
	}
}
