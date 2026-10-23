import type { DiffFileSort } from '@humanlayer/ui/components/diff-review/diff-file-sort-toggle'
import { createContext, type ReactNode, use, useState } from 'react'
import { useStore } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import { createStore, type StoreApi } from 'zustand/vanilla'

interface TaskDiffVisibilityState {
	hideReviewed: boolean
	fileSort: DiffFileSort
	/**
	 * The recency order taken when the review opened or when the reader chose that order.
	 * Held per task so every diff surface reads one order, and so a file the agent writes
	 * to again does not jump while the reader is in it. Files added since are not listed
	 * and lead the review.
	 */
	fileOrderIds: readonly string[]
	revealedFileId: string | null
	dismissedDeepLinkFileId: string | null
	setHideReviewed: (hideReviewed: boolean) => void
	setFileSort: (fileSort: DiffFileSort) => void
	setFileOrder: (fileOrderIds: readonly string[]) => void
	revealFile: (fileId: string) => void
	clearReveal: () => void
	dismissDeepLink: (fileId: string | null) => void
}

type TaskDiffVisibilityStore = StoreApi<TaskDiffVisibilityState>

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

export function createTaskDiffVisibilityStore(
	taskId: string,
	storage: StateStorage = typeof window === 'undefined' ? noopStorage : window.sessionStorage,
): TaskDiffVisibilityStore {
	return createStore<TaskDiffVisibilityState>()(
		persist(
			(set) => ({
				hideReviewed: false,
				fileSort: 'path',
				fileOrderIds: [],
				revealedFileId: null,
				dismissedDeepLinkFileId: null,
				setHideReviewed: (hideReviewed) => set({ hideReviewed, revealedFileId: null }),
				// Choosing an order re-reads it from the files as they stand now.
				setFileSort: (fileSort) => set({ fileSort, fileOrderIds: [] }),
				setFileOrder: (fileOrderIds) => set({ fileOrderIds }),
				revealFile: (revealedFileId) => set({ revealedFileId }),
				clearReveal: () => set({ revealedFileId: null }),
				dismissDeepLink: (dismissedDeepLinkFileId) => set({ dismissedDeepLinkFileId }),
			}),
			{
				name: `riptide-task-diff-visibility:${taskId}`,
				storage: createJSONStorage(() => storage),
				partialize: ({ hideReviewed, fileSort }) => ({ hideReviewed, fileSort }) as TaskDiffVisibilityState,
			},
		),
	)
}

const TaskDiffVisibilityStoreContext = createContext<TaskDiffVisibilityStore | null>(null)

export function TaskDiffVisibilityStoreProvider({ taskId, children }: { taskId: string; children: ReactNode }) {
	const [store] = useState(() => createTaskDiffVisibilityStore(taskId))
	return <TaskDiffVisibilityStoreContext.Provider value={store}>{children}</TaskDiffVisibilityStoreContext.Provider>
}

export function useTaskDiffVisibilityStore<T>(selector: (state: TaskDiffVisibilityState) => T): T {
	const store = use(TaskDiffVisibilityStoreContext)
	if (!store) throw new Error('useTaskDiffVisibilityStore must be used within TaskDiffVisibilityStoreProvider')
	return useStore(store, selector)
}

export function useTaskDiffVisibilityStoreApi(): TaskDiffVisibilityStore {
	const store = use(TaskDiffVisibilityStoreContext)
	if (!store) throw new Error('useTaskDiffVisibilityStoreApi must be used within TaskDiffVisibilityStoreProvider')
	return store
}
