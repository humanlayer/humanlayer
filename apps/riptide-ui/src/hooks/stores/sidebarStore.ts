import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { LEFT_SIDEBAR_LAYOUT_STORAGE_KEY } from '@/lib/preferences'

interface SidebarLayoutState {
	sidebarCollapsed: boolean
	expandedTaskIds: string[]
	setSidebarCollapsed: (collapsed: boolean) => void
	toggleSidebar: () => void
	expandTask: (taskId: string) => void
	collapseTask: (taskId: string) => void
	toggleTask: (taskId: string) => void
	resetExpandedTasks: () => void
}

export const useSidebarStore = create<SidebarLayoutState>()(
	persist(
		(set) => ({
			sidebarCollapsed: false,
			expandedTaskIds: [],
			setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
			toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
			expandTask: (taskId) =>
				set((state) =>
					state.expandedTaskIds.includes(taskId)
						? state
						: { expandedTaskIds: [...state.expandedTaskIds, taskId] },
				),
			collapseTask: (taskId) =>
				set((state) => ({ expandedTaskIds: state.expandedTaskIds.filter((id) => id !== taskId) })),
			toggleTask: (taskId) =>
				set((state) => ({
					expandedTaskIds: state.expandedTaskIds.includes(taskId)
						? state.expandedTaskIds.filter((id) => id !== taskId)
						: [...state.expandedTaskIds, taskId],
				})),
			resetExpandedTasks: () => set({ expandedTaskIds: [] }),
		}),
		{
			name: LEFT_SIDEBAR_LAYOUT_STORAGE_KEY,
			partialize: (state) => ({
				sidebarCollapsed: state.sidebarCollapsed,
			}),
		},
	),
)
