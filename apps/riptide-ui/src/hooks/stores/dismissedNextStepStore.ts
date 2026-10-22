import { create } from 'zustand'

interface DismissedNextStepState {
	dismissedEventIds: Set<string>
	dismiss: (eventId: string) => void
	isDismissed: (eventId: string) => boolean
	clear: () => void
}

export const useDismissedNextStepStore = create<DismissedNextStepState>((set, get) => ({
	dismissedEventIds: new Set(),

	dismiss: (eventId) =>
		set((state) => {
			if (state.dismissedEventIds.has(eventId)) return state
			const next = new Set(state.dismissedEventIds)
			next.add(eventId)
			return { dismissedEventIds: next }
		}),

	isDismissed: (eventId) => get().dismissedEventIds.has(eventId),

	clear: () => set({ dismissedEventIds: new Set() }),
}))
