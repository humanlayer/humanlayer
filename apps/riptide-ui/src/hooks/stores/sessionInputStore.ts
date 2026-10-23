import { create } from 'zustand'

interface SessionInputStore {
	appendToEditor: ((text: string) => void) | null
	setAppendHandler: (handler: ((text: string) => void) | null) => void
}

export const useSessionInputStore = create<SessionInputStore>((set) => ({
	appendToEditor: null,
	setAppendHandler: (handler) => set({ appendToEditor: handler }),
}))
