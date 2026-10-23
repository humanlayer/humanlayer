import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

import { RIGHT_SIDEBAR_SIZE_STORAGE_KEY } from '@/lib/preferences'

export type RightSidebarMode = 'normal' | 'artifact'

export const DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT = 20
export const DEFAULT_ARTIFACT_RIGHT_SIDEBAR_SIZE_PERCENT = 50
interface RightSidebarSizeState {
	currentSizePercent: number
	normalSizePercent: number
	artifactSizePercent: number
	setCurrentSizeForMode: (mode: RightSidebarMode, percent: number) => void
	getSizeForMode: (mode: RightSidebarMode) => number
}

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

export function isValidRightSidebarSizePercent(percent: number): boolean {
	return Number.isFinite(percent) && percent > 0
}

export function isValidCurrentRightSidebarSizePercent(percent: number): boolean {
	return Number.isFinite(percent) && percent >= 0
}

export function getRightSidebarSizeForMode(
	state: Pick<RightSidebarSizeState, 'normalSizePercent' | 'artifactSizePercent'>,
	mode: RightSidebarMode,
): number {
	return mode === 'artifact' ? state.artifactSizePercent : state.normalSizePercent
}

export const useRightSidebarSizeStore = create<RightSidebarSizeState>()(
	persist(
		(set, get) => ({
			currentSizePercent: DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT,
			normalSizePercent: DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT,
			artifactSizePercent: DEFAULT_ARTIFACT_RIGHT_SIDEBAR_SIZE_PERCENT,
			setCurrentSizeForMode: (mode, percent) => {
				if (!isValidCurrentRightSidebarSizePercent(percent)) return

				set((state) => {
					if (percent === 0) return { currentSizePercent: 0 }

					const current = getRightSidebarSizeForMode(state, mode)
					if (Math.abs(current - percent) < 0.1 && Math.abs(state.currentSizePercent - percent) < 0.1) {
						return state
					}

					return mode === 'artifact'
						? { currentSizePercent: percent, artifactSizePercent: percent }
						: { currentSizePercent: percent, normalSizePercent: percent }
				})
			},
			getSizeForMode: (mode) => getRightSidebarSizeForMode(get(), mode),
		}),
		{
			name: RIGHT_SIDEBAR_SIZE_STORAGE_KEY,
			storage: createJSONStorage(() => (typeof localStorage === 'undefined' ? noopStorage : localStorage)),
			version: 1,
			migrate: (persistedState) => {
				const state = persistedState as Partial<RightSidebarSizeState> & { sidebarCollapsed?: boolean }
				return {
					...state,
					currentSizePercent: state.sidebarCollapsed
						? 0
						: (state.currentSizePercent ??
							state.normalSizePercent ??
							DEFAULT_NORMAL_RIGHT_SIDEBAR_SIZE_PERCENT),
				}
			},
			partialize: (state) => ({
				currentSizePercent: state.currentSizePercent,
				normalSizePercent: state.normalSizePercent,
				artifactSizePercent: state.artifactSizePercent,
			}),
		},
	),
)
