import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export const GITHUB_PUSH_CARD_STORAGE_KEY = 'riptide-github-push-card'

interface GitHubPushCardState {
	/** Sessions whose connect ask the reader answered with Later, keyed by session id: once for the session, not once per push. */
	dismissed: Record<string, true>
	/** Push tool calls whose pull request card has had its showing, keyed by tool call id. */
	seen: Record<string, true>
	/** Push tool calls whose pull request card was followed to the GitHub tab, ending it there and then. */
	taken: Record<string, true>
	dismiss: (sessionId: string) => void
	markSeen: (toolCallId: string) => void
	take: (toolCallId: string) => void
}

const noopStorage: StateStorage = {
	getItem: () => null,
	setItem: () => {},
	removeItem: () => {},
}

/**
 * Persisted: a push is a moment in a session's history, so a card answered there must stay
 * answered on the next visit. The connect ask goes with Later; the pull request card that replaces
 * it is a notice shown once: it goes when the reader leaves the session, or there and then if the
 * GitHub tab it points at is opened.
 */
export const useGitHubPushCardStore = create<GitHubPushCardState>()(
	persist(
		(set) => ({
			dismissed: {},
			seen: {},
			taken: {},
			dismiss: (sessionId) =>
				set((state) =>
					state.dismissed[sessionId] ? state : { dismissed: { ...state.dismissed, [sessionId]: true } },
				),
			markSeen: (toolCallId) =>
				set((state) => (state.seen[toolCallId] ? state : { seen: { ...state.seen, [toolCallId]: true } })),
			take: (toolCallId) =>
				set((state) => (state.taken[toolCallId] ? state : { taken: { ...state.taken, [toolCallId]: true } })),
		}),
		{
			name: GITHUB_PUSH_CARD_STORAGE_KEY,
			storage: createJSONStorage(() => (typeof localStorage === 'undefined' ? noopStorage : localStorage)),
			partialize: (state) => ({ dismissed: state.dismissed, seen: state.seen, taken: state.taken }),
		},
	),
)
