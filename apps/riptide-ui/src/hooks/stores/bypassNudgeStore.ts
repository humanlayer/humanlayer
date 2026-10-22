import { create } from 'zustand'

/**
 * In-memory (non-persisted) store tracking which sessions have had
 * the bypass-permissions nudge dismissed during this app session.
 * Survives route navigation but resets on page reload.
 */
interface BypassNudgeState {
	/** Session IDs where the nudge was dismissed */
	dismissedSessionIds: Set<string>
	dismissNudgeForSession: (sessionId: string) => void
	isNudgeDismissedForSession: (sessionId: string) => boolean
}

export const useBypassNudgeStore = create<BypassNudgeState>((set, get) => ({
	dismissedSessionIds: new Set(),
	dismissNudgeForSession: (sessionId) =>
		set((state) => ({
			dismissedSessionIds: new Set(state.dismissedSessionIds).add(sessionId),
		})),
	isNudgeDismissedForSession: (sessionId) => get().dismissedSessionIds.has(sessionId),
}))
