import type { DiffReviewComparison } from '@humanlayer/ui/lib/diff-review/build-code-view-items'
import { createDiffHeaderNavigationTarget } from '@humanlayer/ui/lib/diff-review/build-diff-navigation-index'
import { projectDiffComments, type ProjectedDiffComments } from '@humanlayer/ui/lib/diff-review/project-diff-comments'
import { eq, useLiveQuery } from '@tanstack/react-db'
import { useCallback, useMemo } from 'react'

import { useSync } from '@/components/providers/SyncProvider'
import { useTaskDiffFocusStore } from '@/hooks/stores/taskDiffFocusStore'
import { type DiffComparison, taskDiffFileKey } from '@/hooks/stores/taskDiffReviewMarksStore'
import {
	type DiffReviewPlacement,
	type DiffReviewPresentation,
	useTaskDiffReviewStore,
} from '@/hooks/stores/taskDiffReviewStore'
import { useTaskDiffVisibilityStore, useTaskDiffVisibilityStoreApi } from '@/hooks/stores/taskDiffVisibilityStore'

import { useTaskDiffComments } from './useTaskDiffComments'
import { useTaskDiffComparisons } from './useTaskDiffComparisons'
import {
	type TaskDiffDeepLinkSearch,
	type TaskDiffDeepLinkTarget,
	useTaskDiffDeepLinkTarget,
} from './useTaskDiffDeepLinkTarget'
import { useTaskDiffFiles, type TaskDiffFilesResult } from './useTaskDiffFiles'
import { getTaskDiffReviewedIds } from './useTaskDiffFileVisibility'
import {
	type TaskDiffReviewedFile,
	type TaskDiffReviewedState,
	useTaskDiffReviewedState,
} from './useTaskDiffReviewedState'
import { type TaskDiffVersionsResult, useTaskDiffVersions } from './useTaskDiffVersions'

export interface TaskDiffReviewModel {
	taskId: string
	organizationId: string
	resourceOwnerUserId: string
	files: TaskDiffFilesResult
	versions: TaskDiffVersionsResult
	/** The two bodies each current text file is compared across, per `comparison`. */
	comparisons: readonly DiffReviewComparison[]
	/** What each diff's left side is; saved per task. */
	comparison: DiffComparison
	setComparison: (comparison: DiffComparison) => void
	/** Files with a side too large to publish. */
	omittedFileIds: ReadonlySet<string>
	comments: ProjectedDiffComments
	commentsLoading: boolean
	mode: 'conversation' | 'diff'
	activePresentation: DiffReviewPresentation | null
	activePlacement: DiffReviewPlacement | null
	preferredPlacement: DiffReviewPlacement
	canOpenPrimary: boolean
	selectedFileId: string | null
	reviewedIds: ReadonlySet<string>
	collapsedIds: ReadonlySet<string>
	reviewedLines: number
	totalLines: number
	reviewActions: TaskDiffReviewedState['reviewActions']
	selectFile: (fileId: string) => void
	openFile: (fileId: string) => DiffReviewPlacement
	openIn: (placement: DiffReviewPlacement, fileId?: string) => void
	openSidebar: (fileId?: string) => void
	openFullscreen: () => void
	closeFullscreen: () => void
	closePrimary: () => void
	closeSidebar: () => void
	setPreferredPlacement: (placement: DiffReviewPlacement) => void
	setReviewed: (file: TaskDiffReviewedFile, reviewed: boolean) => void
	setCollapsed: (file: TaskDiffReviewedFile, collapsed: boolean) => void
	openFileInEditor?: (file: TaskDiffEditorFile) => void
	copyFilePath?: (file: TaskDiffEditorFile) => void
	deepLinkTarget: TaskDiffDeepLinkTarget | null
}

export interface TaskDiffEditorFile {
	readonly repoId: string
	readonly path: string
}

export interface UseTaskDiffReviewModelOptions {
	readonly allowPrimary?: boolean
	readonly openFileInEditor?: (file: TaskDiffEditorFile) => void
	/** Copies the path `openFileInEditor` would open. */
	readonly copyFilePath?: (file: TaskDiffEditorFile) => void
	readonly deepLinkSearch?: TaskDiffDeepLinkSearch | null
}

/** Owns the session's single task-diff data and review-state composition. */
export function useTaskDiffReviewModel(
	taskId: string | null | undefined,
	{ allowPrimary = true, openFileInEditor, copyFilePath, deepLinkSearch }: UseTaskDiffReviewModelOptions = {},
): TaskDiffReviewModel {
	const { tasksCollection } = useSync()
	const { data: tasks } = useLiveQuery(
		(q) => (taskId ? q.from({ tasks: tasksCollection }).where(({ tasks }) => eq(tasks.id, taskId)) : undefined),
		[tasksCollection, taskId],
	)
	const task = tasks?.[0]
	const organizationId = task?.organization_id ?? ''
	const resourceOwnerUserId = task?.resource_owner_user_id ?? ''
	const selectedFileId =
		useTaskDiffReviewStore((state) => (taskId ? state.selectedFileByTask[taskId] : undefined)) ?? null
	const presentation = useTaskDiffReviewStore((state) => (taskId ? state.presentationByTask[taskId] : undefined)) ?? {
		active: null,
		fullscreenOrigin: null,
	}
	const activePlacement = presentation.active === 'fullscreen' ? null : presentation.active
	const setSelectedFile = useTaskDiffReviewStore((state) => state.setSelectedFile)
	const setPresentation = useTaskDiffReviewStore((state) => state.setPresentation)
	const visibilityStore = useTaskDiffVisibilityStoreApi()
	const dismissedDeepLinkFileId = useTaskDiffVisibilityStore((state) => state.dismissedDeepLinkFileId)
	const storedPreferredPlacement = useTaskDiffReviewStore((state) => state.preferredPlacement)
	const setStoredPreferredPlacement = useTaskDiffReviewStore((state) => state.setPreferredPlacement)
	const preferredPlacement = allowPrimary ? storedPreferredPlacement : 'sidebar'
	const files = useTaskDiffFiles(
		taskId,
		task?.organization_id,
		task?.workspace_id ?? null,
		task?.workspace_state ?? null,
	)
	const versions = useTaskDiffVersions(taskId, task?.organization_id)
	const reviewedState = useTaskDiffReviewedState(taskId ?? null, files.rows)
	const { comparisons, omittedFileIds } = useTaskDiffComparisons(files.rows, versions, {
		comparison: reviewedState.comparison,
		reviewed: reviewedState.entries,
		unmarked: reviewedState.unmarkedEntries,
	})
	const comments = useTaskDiffComments(taskId ?? '')
	const deepLinkTarget = useTaskDiffDeepLinkTarget({
		taskId: taskId ?? '',
		files,
		comments,
		diffFileId: deepLinkSearch?.diffFileId ?? null,
		diffCommentId: deepLinkSearch?.diffCommentId ?? null,
		diffPresentation: deepLinkSearch?.diffPresentation ?? null,
	})
	const stableFiles = useMemo(() => files, [files.error, files.rows, files.status])
	const stableVersions = useMemo(
		() => versions,
		[versions.baselines, versions.error, versions.protocol, versions.status, versions.versions],
	)
	const projectedComments = useMemo(
		() => projectDiffComments({ comments: comments.rows, files: files.rows, comparisons }),
		[comments.rows, comparisons, files.rows],
	)

	const reviewedIds = useMemo(
		() => getTaskDiffReviewedIds(files.rows, reviewedState.entries),
		[files.rows, reviewedState.entries],
	)
	const collapsedIds = useMemo(
		() =>
			files.rows.reduce<Set<string>>((ids, file) => {
				const entry = reviewedState.collapsedEntries[taskDiffFileKey(file)]
				if (!file.versionId) return ids
				if (entry?.versionId === file.versionId ? entry.collapsed : file.generated && entry === undefined) {
					ids.add(file.id)
				}
				return ids
			}, new Set()),
		[files.rows, reviewedState.collapsedEntries],
	)
	const totalLines = useMemo(
		() => files.rows.reduce((total, file) => total + file.additions + file.deletions, 0),
		[files.rows],
	)
	const reviewedLines = useMemo(
		() =>
			files.rows.reduce(
				(total, file) => total + (reviewedIds.has(file.id) ? file.additions + file.deletions : 0),
				0,
			),
		[files.rows, reviewedIds],
	)

	const requestedFileId =
		deepLinkTarget?.status === 'ready' || deepLinkTarget?.status === 'missing-file'
			? deepLinkTarget.fileId
			: deepLinkTarget?.requestedFileId
	const activeRequestedFileId = requestedFileId === dismissedDeepLinkFileId ? null : (requestedFileId ?? null)
	// Dismissal must also stop mount appliers, not just change the derived selection.
	const activeDeepLinkTarget = requestedFileId && !activeRequestedFileId ? null : deepLinkTarget
	const effectiveSelectedFileId = activeRequestedFileId
		? files.rows.some((file) => file.id === activeRequestedFileId)
			? activeRequestedFileId
			: null
		: presentation.active !== null
			? (files.rows.find((file) => file.id === selectedFileId)?.id ?? files.rows[0]?.id ?? null)
			: selectedFileId

	const openIn = useCallback(
		(placement: DiffReviewPlacement, fileId?: string) => {
			if (!taskId) return
			const nextPlacement = allowPrimary ? placement : 'sidebar'
			// An explicit open is navigation, even for the already-selected file.
			// Presentation-only opens must preserve the current line/range instead.
			if (fileId !== undefined) {
				useTaskDiffFocusStore.getState().setKeyboardFocus(taskId, createDiffHeaderNavigationTarget(fileId))
			}
			setSelectedFile(
				taskId,
				fileId ?? files.rows.find((file) => file.id === selectedFileId)?.id ?? files.rows[0]?.id ?? null,
			)
			setPresentation(taskId, { active: nextPlacement, fullscreenOrigin: null })
		},
		[allowPrimary, files.rows, selectedFileId, setPresentation, setSelectedFile, taskId],
	)
	const selectFile = useCallback(
		(fileId: string) => {
			if (!taskId) return
			visibilityStore.getState().clearReveal()
			visibilityStore.getState().dismissDeepLink(requestedFileId ?? null)
			setSelectedFile(taskId, fileId)
		},
		[requestedFileId, setSelectedFile, taskId, visibilityStore],
	)
	const openFile = useCallback(
		(fileId: string) => {
			// Unlike a deep-link presentation open, this is a new user navigation.
			selectFile(fileId)
			openIn(preferredPlacement, fileId)
			return preferredPlacement
		},
		[openIn, preferredPlacement, selectFile],
	)
	const openSidebar = useCallback((fileId?: string) => openIn('sidebar', fileId), [openIn])
	const openFullscreen = useCallback(() => {
		if (!taskId) return
		const fullscreenOrigin = presentation.active === 'primary' ? 'primary' : 'sidebar'
		setSelectedFile(taskId, files.rows.find((file) => file.id === selectedFileId)?.id ?? files.rows[0]?.id ?? null)
		setPresentation(taskId, { active: 'fullscreen', fullscreenOrigin })
	}, [files.rows, presentation.active, selectedFileId, setPresentation, setSelectedFile, taskId])
	const closeFullscreen = useCallback(() => {
		if (!taskId || presentation.active !== 'fullscreen') return
		setPresentation(taskId, { active: presentation.fullscreenOrigin ?? 'sidebar', fullscreenOrigin: null })
	}, [presentation.active, presentation.fullscreenOrigin, setPresentation, taskId])
	const closePrimary = useCallback(() => {
		if (taskId && activePlacement === 'primary') setPresentation(taskId, { active: null, fullscreenOrigin: null })
	}, [activePlacement, setPresentation, taskId])
	const closeSidebar = useCallback(() => {
		if (taskId && activePlacement === 'sidebar') setPresentation(taskId, { active: null, fullscreenOrigin: null })
	}, [activePlacement, setPresentation, taskId])
	const { setReviewed, setCollapsed, setComparison, comparison } = reviewedState
	const reviewActions = useMemo(
		() => ({
			...reviewedState.reviewActions,
			markAllReviewed: () => {
				reviewedState.reviewActions.markAllReviewed()
				if (!taskId || !visibilityStore.getState().hideReviewed) return
				visibilityStore.getState().clearReveal()
				setSelectedFile(taskId, null)
				useTaskDiffFocusStore.getState().clearFocus(taskId)
			},
		}),
		[reviewedState.reviewActions, setSelectedFile, taskId, visibilityStore],
	)
	const setPreferredPlacement = useCallback(
		(placement: DiffReviewPlacement) => {
			if (placement === 'primary' && !allowPrimary) return
			setStoredPreferredPlacement(placement)
		},
		[allowPrimary, setStoredPreferredPlacement],
	)
	return useMemo(
		() => ({
			taskId: taskId ?? '',
			organizationId,
			resourceOwnerUserId,
			files: stableFiles,
			versions: stableVersions,
			comparisons,
			comparison,
			setComparison,
			omittedFileIds,
			comments: projectedComments,
			commentsLoading: comments.isLoading,
			mode: activePlacement === 'primary' ? ('diff' as const) : ('conversation' as const),
			activePresentation: presentation.active,
			activePlacement,
			preferredPlacement,
			canOpenPrimary: allowPrimary,
			selectedFileId: effectiveSelectedFileId,
			reviewedIds,
			collapsedIds,
			reviewedLines,
			totalLines,
			reviewActions,
			selectFile,
			openFile,
			openIn,
			openSidebar,
			openFullscreen,
			closeFullscreen,
			closePrimary,
			closeSidebar,
			setPreferredPlacement,
			setReviewed,
			setCollapsed,
			openFileInEditor,
			copyFilePath,
			deepLinkTarget: activeDeepLinkTarget,
		}),
		[
			activePlacement,
			allowPrimary,
			collapsedIds,
			comments.isLoading,
			closeFullscreen,
			closePrimary,
			closeSidebar,
			openFile,
			openFileInEditor,
			copyFilePath,
			activeDeepLinkTarget,
			openFullscreen,
			openIn,
			openSidebar,
			organizationId,
			presentation.active,
			preferredPlacement,
			projectedComments,
			resourceOwnerUserId,
			reviewActions,
			reviewedIds,
			reviewedLines,
			effectiveSelectedFileId,
			selectFile,
			setCollapsed,
			setReviewed,
			setPreferredPlacement,
			stableFiles,
			stableVersions,
			comparisons,
			comparison,
			setComparison,
			omittedFileIds,
			totalLines,
			taskId,
		],
	)
}
