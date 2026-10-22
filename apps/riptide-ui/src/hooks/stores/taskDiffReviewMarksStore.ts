import { fileKeyFor } from '@humanlayer/streams/diff'
import type { DiffComparison } from '@humanlayer/ui/components/diff-review/diff-comparison-control'
import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type { DiffComparison }

export const TASK_DIFF_REVIEW_MARKS_STORAGE_KEY = 'riptide-task-diff-review-marks'
export const DEFAULT_DIFF_COMPARISON: DiffComparison = 'since-last-review'

/**
 * One file as review marks see it. `fileKey` survives a detected rename; `versionId` names the
 * body the reader saw. A file without a version (binary) cannot be marked.
 */
export interface TaskDiffReviewMarkFile {
	readonly fileKey: string
	readonly versionId?: string
}

/**
 * The version a reader marked reviewed, and the one they had marked before it. A file whose
 * current version is the reviewed one compares from `previousVersionId`, so it never shows an
 * empty diff.
 */
export interface TaskDiffReviewMark {
	versionId: string
	previousVersionId?: string
}

export interface TaskDiffCollapsedMark {
	versionId: string
	collapsed: boolean
}

interface TaskDiffReviewMarksState {
	/** taskId -> fileKey -> the version marked reviewed and the one marked before it. */
	reviewedByTask: Record<string, Record<string, TaskDiffReviewMark>>
	/**
	 * taskId -> fileKey -> the mark a reader removed. Kept so marking the file again restores
	 * its review history. A file key sits in this map or in `reviewedByTask`, never both.
	 */
	unmarkedByTask: Record<string, Record<string, TaskDiffReviewMark>>
	/** taskId -> fileKey -> collapse choice for one version; a new version starts fresh. */
	collapsedByTask: Record<string, Record<string, TaskDiffCollapsedMark>>
	comparisonByTask: Record<string, DiffComparison>
	/** Used by a task with no saved mode; follows the latest choice on any task. */
	defaultComparison: DiffComparison
	setComparison: (taskId: string, comparison: DiffComparison) => void
	markReviewed: (taskId: string, files: readonly TaskDiffReviewMarkFile[]) => void
	markUnreviewed: (taskId: string, files: readonly TaskDiffReviewMarkFile[]) => void
	setCollapsed: (taskId: string, files: readonly TaskDiffReviewMarkFile[], collapsed: boolean) => void
	/**
	 * Forgets versions the stream no longer holds. A mark whose reviewed version is gone is
	 * dropped; a mark whose previous version is gone loses only that field. Either way the file
	 * falls back to task start.
	 */
	dropReviewVersions: (taskId: string, versionIds: readonly string[]) => void
	/** Forgets every review mark and collapse choice for the task. Keeps its comparison mode. */
	resetReview: (taskId: string) => void
	/** Forgets everything saved for the task, comparison mode included. */
	clearTask: (taskId: string) => void
	/**
	 * Forgets everything saved for the archived tasks. Tasks missing from the synced list are
	 * kept: the list holds one organization, and an empty or failed sync must not wipe marks.
	 */
	pruneTasks: (archivedTaskIds: ReadonlySet<string>) => void
}

type PersistedTaskDiffReviewMarksState = Pick<
	TaskDiffReviewMarksState,
	'reviewedByTask' | 'unmarkedByTask' | 'collapsedByTask' | 'comparisonByTask' | 'defaultComparison'
>

/** The rename-stable key for a current file row. */
export function taskDiffFileKey(file: { repoId: string; path: string; prevPath?: string }): string {
	return fileKeyFor(file.repoId, file.path, file.prevPath)
}

export function getTaskDiffComparison(
	state: Pick<TaskDiffReviewMarksState, 'comparisonByTask' | 'defaultComparison'>,
	taskId: string | null | undefined,
): DiffComparison {
	return (taskId ? state.comparisonByTask[taskId] : undefined) ?? state.defaultComparison
}

function withCollapsed(
	entries: Record<string, TaskDiffCollapsedMark> | undefined,
	files: readonly TaskDiffReviewMarkFile[],
	collapsed: boolean,
): Record<string, TaskDiffCollapsedMark> {
	const next = { ...entries }
	for (const file of files) {
		if (file.versionId) next[file.fileKey] = { versionId: file.versionId, collapsed }
		else delete next[file.fileKey]
	}
	return next
}

/**
 * The mark for `versionId`, given the file's current mark or, failing that, the mark the reader
 * removed. Marking the same version again keeps its history. A new version remembers the last
 * version still approved: the current mark's, or the one before a removed mark.
 */
function nextReviewMark(
	versionId: string,
	reviewed: TaskDiffReviewMark | undefined,
	unmarked: TaskDiffReviewMark | undefined,
): TaskDiffReviewMark {
	if (reviewed) {
		return reviewed.versionId === versionId ? reviewed : { versionId, previousVersionId: reviewed.versionId }
	}
	if (!unmarked) return { versionId }
	if (unmarked.versionId === versionId) return unmarked
	return unmarked.previousVersionId ? { versionId, previousVersionId: unmarked.previousVersionId } : { versionId }
}

/** Returns `marks` itself when no mark names a missing version. */
function withoutVersions(
	marks: Record<string, TaskDiffReviewMark> | undefined,
	missing: ReadonlySet<string>,
): Record<string, TaskDiffReviewMark> | undefined {
	if (!marks) return marks
	let next: Record<string, TaskDiffReviewMark> | undefined
	for (const [fileKey, mark] of Object.entries(marks)) {
		if (missing.has(mark.versionId)) {
			next ??= { ...marks }
			delete next[fileKey]
		} else if (mark.previousVersionId && missing.has(mark.previousVersionId)) {
			next ??= { ...marks }
			next[fileKey] = { versionId: mark.versionId }
		}
	}
	return next ?? marks
}

function withoutTasks<T>(entries: Record<string, T>, taskIds: ReadonlySet<string>): Record<string, T> {
	if (!Object.keys(entries).some((taskId) => taskIds.has(taskId))) return entries
	return Object.fromEntries(Object.entries(entries).filter(([taskId]) => !taskIds.has(taskId)))
}

type TaskEntries = Pick<
	TaskDiffReviewMarksState,
	'reviewedByTask' | 'unmarkedByTask' | 'collapsedByTask' | 'comparisonByTask'
>

/** Returns `state` itself when no entry belongs to `taskIds`, so persist and subscribers skip it. */
function withoutTaskEntries(state: TaskEntries, taskIds: ReadonlySet<string>): TaskEntries {
	const next = {
		reviewedByTask: withoutTasks(state.reviewedByTask, taskIds),
		unmarkedByTask: withoutTasks(state.unmarkedByTask, taskIds),
		collapsedByTask: withoutTasks(state.collapsedByTask, taskIds),
		comparisonByTask: withoutTasks(state.comparisonByTask, taskIds),
	}
	const unchanged = (Object.keys(next) as (keyof TaskEntries)[]).every((key) => next[key] === state[key])
	return unchanged ? state : next
}

/** Version 1 stored the reviewed versionId as a bare string. */
export function migrateTaskDiffReviewMarksState(
	persistedState: unknown,
	version: number,
): Partial<PersistedTaskDiffReviewMarksState> {
	const persisted = (persistedState ?? {}) as Partial<PersistedTaskDiffReviewMarksState>
	if (version >= 2) return persisted
	const legacy = (persisted.reviewedByTask ?? {}) as Record<string, Record<string, unknown>>
	const reviewedByTask = Object.fromEntries(
		Object.entries(legacy).map(([taskId, marks]) => [
			taskId,
			Object.fromEntries(
				Object.entries(marks).flatMap(([fileKey, versionId]) =>
					typeof versionId === 'string' ? [[fileKey, { versionId }]] : [],
				),
			),
		]),
	)
	return { ...persisted, reviewedByTask, unmarkedByTask: {} }
}

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

export const useTaskDiffReviewMarksStore = create<TaskDiffReviewMarksState>()(
	persist(
		(set) => ({
			reviewedByTask: {},
			unmarkedByTask: {},
			collapsedByTask: {},
			comparisonByTask: {},
			defaultComparison: DEFAULT_DIFF_COMPARISON,
			setComparison: (taskId, comparison) =>
				set((state) => ({
					comparisonByTask: { ...state.comparisonByTask, [taskId]: comparison },
					defaultComparison: comparison,
				})),
			markReviewed: (taskId, files) =>
				set((state) => {
					const reviewed = { ...state.reviewedByTask[taskId] }
					const unmarked = { ...state.unmarkedByTask[taskId] }
					const marked = files.filter((file) => file.versionId)
					for (const file of marked) {
						reviewed[file.fileKey] = nextReviewMark(
							file.versionId as string,
							reviewed[file.fileKey],
							unmarked[file.fileKey],
						)
						delete unmarked[file.fileKey]
					}
					return {
						reviewedByTask: { ...state.reviewedByTask, [taskId]: reviewed },
						unmarkedByTask: { ...state.unmarkedByTask, [taskId]: unmarked },
						collapsedByTask: {
							...state.collapsedByTask,
							[taskId]: withCollapsed(state.collapsedByTask[taskId], marked, true),
						},
					}
				}),
			markUnreviewed: (taskId, files) =>
				set((state) => {
					const reviewed = { ...state.reviewedByTask[taskId] }
					const unmarked = { ...state.unmarkedByTask[taskId] }
					for (const file of files) {
						const mark = reviewed[file.fileKey]
						if (!mark) continue
						unmarked[file.fileKey] = mark
						delete reviewed[file.fileKey]
					}
					return {
						reviewedByTask: { ...state.reviewedByTask, [taskId]: reviewed },
						unmarkedByTask: { ...state.unmarkedByTask, [taskId]: unmarked },
						collapsedByTask: {
							...state.collapsedByTask,
							[taskId]: withCollapsed(state.collapsedByTask[taskId], files, false),
						},
					}
				}),
			setCollapsed: (taskId, files, collapsed) =>
				set((state) => ({
					collapsedByTask: {
						...state.collapsedByTask,
						[taskId]: withCollapsed(state.collapsedByTask[taskId], files, collapsed),
					},
				})),
			dropReviewVersions: (taskId, versionIds) =>
				set((state) => {
					const missing = new Set(versionIds)
					const reviewed = withoutVersions(state.reviewedByTask[taskId], missing)
					const unmarked = withoutVersions(state.unmarkedByTask[taskId], missing)
					if (reviewed === state.reviewedByTask[taskId] && unmarked === state.unmarkedByTask[taskId]) {
						return state
					}
					return {
						reviewedByTask: { ...state.reviewedByTask, [taskId]: reviewed ?? {} },
						unmarkedByTask: { ...state.unmarkedByTask, [taskId]: unmarked ?? {} },
					}
				}),
			resetReview: (taskId) =>
				set((state) => {
					const { reviewedByTask, unmarkedByTask, collapsedByTask } = withoutTaskEntries(
						state,
						new Set([taskId]),
					)
					return { reviewedByTask, unmarkedByTask, collapsedByTask }
				}),
			clearTask: (taskId) => set((state) => withoutTaskEntries(state, new Set([taskId]))),
			pruneTasks: (archivedTaskIds) => set((state) => withoutTaskEntries(state, archivedTaskIds)),
		}),
		{
			name: TASK_DIFF_REVIEW_MARKS_STORAGE_KEY,
			version: 2,
			migrate: migrateTaskDiffReviewMarksState,
			storage: createJSONStorage(() => (typeof localStorage === 'undefined' ? noopStorage : localStorage)),
			partialize: (state): PersistedTaskDiffReviewMarksState => ({
				reviewedByTask: state.reviewedByTask,
				unmarkedByTask: state.unmarkedByTask,
				collapsedByTask: state.collapsedByTask,
				comparisonByTask: state.comparisonByTask,
				defaultComparison: state.defaultComparison,
			}),
		},
	),
)
