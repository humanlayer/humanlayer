import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const MAX_HISTORY = 10

export type NavigationHistoryEntryType = 'task' | 'session'

export interface HistoryEntry {
	id: string
	type: NavigationHistoryEntryType
	visitedAt: number
}

interface NavigationHistoryState {
	history: HistoryEntry[]
	recordVisit: (id: string, type: NavigationHistoryEntryType) => void
}

export const useNavigationHistoryStore = create<NavigationHistoryState>()(
	persist(
		(set) => ({
			history: [],

			recordVisit: (id, type) =>
				set((prev) => ({
					history: [
						{ id, type, visitedAt: Date.now() },
						...prev.history.filter((entry) => !(entry.id === id && entry.type === type)),
					].slice(0, MAX_HISTORY),
				})),
		}),
		{
			name: 'riptide-navigation-history',
			partialize: (state) => ({ history: state.history }),
		},
	),
)
