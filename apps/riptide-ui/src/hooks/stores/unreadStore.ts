import { create } from 'zustand'

interface UnreadState {
	unreadSessionIds: Set<string>

	markUnread: (sessionId: string) => void
	markRead: (sessionId: string) => void
	isUnread: (sessionId: string) => boolean
	clear: () => void
}

export const useUnreadStore = create<UnreadState>((set, get) => ({
	unreadSessionIds: new Set(),

	markUnread: (sessionId) =>
		set((state) => {
			if (state.unreadSessionIds.has(sessionId)) {
				return state
			}
			const next = new Set(state.unreadSessionIds)
			next.add(sessionId)
			return { unreadSessionIds: next }
		}),

	markRead: (sessionId) =>
		set((state) => {
			if (!state.unreadSessionIds.has(sessionId)) {
				return state
			}
			const next = new Set(state.unreadSessionIds)
			next.delete(sessionId)
			return { unreadSessionIds: next }
		}),

	isUnread: (sessionId) => get().unreadSessionIds.has(sessionId),

	clear: () => set({ unreadSessionIds: new Set() }),
}))
