import type { DiffFileSort } from '@humanlayer/ui/components/diff-review/diff-file-sort-toggle'
import { useMemo } from 'react'

import { useTaskDiffDatabases } from '@/components/diffs/task-diff-context'
import { rankTaskDiffFilesByRecency } from '@/hooks/diffs/sort-task-diff-files'
import {
	type TaskDiffReviewMark,
	taskDiffFileKey,
	useTaskDiffReviewMarksStore,
} from '@/hooks/stores/taskDiffReviewMarksStore'
import { useTaskDiffReviewStore } from '@/hooks/stores/taskDiffReviewStore'
import { useTaskDiffVisibilityStore, useTaskDiffVisibilityStoreApi } from '@/hooks/stores/taskDiffVisibilityStore'
import { useMountEffect } from '@/hooks/useMountEffect'

import { useCurrentTaskDiffFiles } from './useTaskDiffFiles'

const EMPTY_REVIEWED_ENTRIES: Record<string, TaskDiffReviewMark> = {}

/**
 * IDs of files whose current version is the one last marked reviewed. Marks are keyed by
 * `fileKey`, so a detected rename keeps its mark; a new version reopens the file.
 */
export function getTaskDiffReviewedIds(
	files: readonly { id: string; repoId: string; path: string; prevPath?: string; versionId?: string }[],
	reviewedEntries: Readonly<Record<string, TaskDiffReviewMark>>,
): ReadonlySet<string> {
	return files.reduce<Set<string>>((ids, file) => {
		if (file.versionId && reviewedEntries[taskDiffFileKey(file)]?.versionId === file.versionId) ids.add(file.id)
		return ids
	}, new Set())
}

export function getVisibleTaskDiffFiles<T extends { id: string }>(
	files: readonly T[],
	reviewedIds: ReadonlySet<string>,
	hideReviewed: boolean,
	revealedFileId: string | null,
): readonly T[] {
	if (!hideReviewed) return files
	return files.filter((file) => !reviewedIds.has(file.id) || file.id === revealedFileId)
}

export function getTaskDiffSelectionFallback<T extends { id: string }>(
	files: readonly T[],
	reviewedIds: ReadonlySet<string>,
	selectedFileId: string,
): string | null {
	const currentIndex = files.findIndex((file) => file.id === selectedFileId)
	const nextFile = files.slice(currentIndex + 1).find((file) => !reviewedIds.has(file.id))
	const previousFile = files
		.slice(0, currentIndex)
		.reverse()
		.find((file) => !reviewedIds.has(file.id))
	return nextFile?.id ?? previousFile?.id ?? null
}

export function useTaskDiffFileVisibility(requestedFileId: string | null = null) {
	const { taskId } = useTaskDiffDatabases()
	const files = useCurrentTaskDiffFiles()
	const reviewedEntries = useTaskDiffReviewMarksStore((state) => state.reviewedByTask[taskId])
	const selectedFileId = useTaskDiffReviewStore((state) => state.selectedFileByTask[taskId] ?? null)
	const setSelectedFile = useTaskDiffReviewStore((state) => state.setSelectedFile)
	const hideReviewed = useTaskDiffVisibilityStore((state) => state.hideReviewed)
	const fileSort = useTaskDiffVisibilityStore((state) => state.fileSort)
	const setStoredFileSort = useTaskDiffVisibilityStore((state) => state.setFileSort)
	const setFileOrder = useTaskDiffVisibilityStore((state) => state.setFileOrder)
	const visibilityStore = useTaskDiffVisibilityStoreApi()
	const revealedFileId = useTaskDiffVisibilityStore((state) => state.revealedFileId)
	const dismissedDeepLinkFileId = useTaskDiffVisibilityStore((state) => state.dismissedDeepLinkFileId)
	const setStoredHideReviewed = useTaskDiffVisibilityStore((state) => state.setHideReviewed)
	const setRevealedFile = useTaskDiffVisibilityStore((state) => state.revealFile)
	const clearReveal = useTaskDiffVisibilityStore((state) => state.clearReveal)
	const dismissDeepLink = useTaskDiffVisibilityStore((state) => state.dismissDeepLink)
	const reviewedIds = useMemo(
		() => getTaskDiffReviewedIds(files.rows, reviewedEntries ?? EMPTY_REVIEWED_ENTRIES),
		[files.rows, reviewedEntries],
	)
	const activeRequestedFileId = requestedFileId === dismissedDeepLinkFileId ? null : requestedFileId
	const visibleFiles = useMemo(
		() => getVisibleTaskDiffFiles(files.rows, reviewedIds, hideReviewed, revealedFileId ?? activeRequestedFileId),
		[activeRequestedFileId, files.rows, hideReviewed, revealedFileId, reviewedIds],
	)
	// Take the recency order once, when the review opens. Holding it still is the point:
	// a file the agent writes to again keeps its place instead of jumping over whatever
	// the reader is part way through. Files added since lead the list, and choosing the
	// order again re-reads it.
	useMountEffect(() => {
		const { fileSort: currentSort, fileOrderIds, setFileOrder } = visibilityStore.getState()
		if (currentSort !== 'recent' || fileOrderIds.length > 0) return
		setFileOrder(rankTaskDiffFilesByRecency(files.rows).map((file) => file.id))
	})

	// Picking an order reads it from the files as they stand at that moment, and it then
	// holds: this is the reader saying "show me the newest", not a request to be reshuffled
	// on every capture that follows.
	const setFileSort = (nextFileSort: DiffFileSort) => {
		setStoredFileSort(nextFileSort)
		if (nextFileSort === 'recent') {
			setFileOrder(rankTaskDiffFilesByRecency(files.rows).map((file) => file.id))
		}
	}

	const setHideReviewed = (nextHideReviewed: boolean) => {
		setStoredHideReviewed(nextHideReviewed)
		if (!nextHideReviewed || !selectedFileId || !reviewedIds.has(selectedFileId)) return
		setSelectedFile(taskId, getTaskDiffSelectionFallback(files.rows, reviewedIds, selectedFileId))
	}
	const revealFile = (fileId: string) => {
		setRevealedFile(fileId)
		setSelectedFile(taskId, fileId)
	}
	const selectedVisibleFileId = activeRequestedFileId
		? files.rows.some((file) => file.id === activeRequestedFileId)
			? activeRequestedFileId
			: null
		: visibleFiles.some((file) => file.id === selectedFileId)
			? selectedFileId
			: (visibleFiles[0]?.id ?? null)

	return {
		files,
		visibleFiles,
		reviewedIds,
		selectedVisibleFileId,
		hideReviewed,
		setHideReviewed,
		fileSort,
		setFileSort,
		// Mapped once here: a surface that derived it again could show the tree in one
		// order while the diff stack walked another, which is the split this feature exists
		// to avoid.
		treeOrder: fileSort === 'recent' ? ('given' as const) : ('path' as const),
		revealFile,
		clearReveal,
		dismissDeepLink,
	}
}
