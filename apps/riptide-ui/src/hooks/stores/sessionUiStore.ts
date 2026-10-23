import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

type BooleanUpdate = boolean | ((previous: boolean) => boolean)

interface SessionUiState {
	modelSelectorOpen: boolean
	isTerminalOpen: boolean
	setModelSelectorOpen: (open: BooleanUpdate) => void
	setIsTerminalOpen: (open: BooleanUpdate) => void
	toggleTaskTerminal: () => void
}

/** Transient UI only: no persistence, session registry, editor callbacks or live-query snapshots. */
export function createSessionUiStore() {
	return createStore<SessionUiState>()((set) => ({
		modelSelectorOpen: false,
		// Avoid xterm initialization until explicitly opened, including on return navigation.
		isTerminalOpen: false,
		setModelSelectorOpen: (update) =>
			set((state) => {
				const open = typeof update === 'function' ? update(state.modelSelectorOpen) : update
				return open === state.modelSelectorOpen ? state : { modelSelectorOpen: open }
			}),
		setIsTerminalOpen: (update) =>
			set((state) => {
				const open = typeof update === 'function' ? update(state.isTerminalOpen) : update
				return open === state.isTerminalOpen ? state : { isTerminalOpen: open }
			}),
		toggleTaskTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen })),
	}))
}

export const SessionUiStoreContext = createContext<ReturnType<typeof createSessionUiStore> | null>(null)

/** Non-subscribing access for command owners; never republish getState() as page context. */
export function useSessionUiStoreApi() {
	const store = use(SessionUiStoreContext)
	if (!store) throw new Error('useSessionUiStoreApi must be used within SessionUiStoreProvider')
	return store
}

export function useSessionUiStore<T>(selector: (state: SessionUiState) => T): T {
	return useStore(useSessionUiStoreApi(), selector)
}
