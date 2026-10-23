import { create } from 'zustand'

interface OpenPullRequestBarState {
	/** Branches whose bar the reader has waved away, keyed by repository and branch. */
	dismissed: Record<string, true>
	dismiss: (key: string) => void
}

/**
 * Not persisted: a branch deliberately kept without a pull request is usually deliberate for an
 * afternoon, not forever, and a dismissal that outlives the app would hide the bar on a branch
 * the reader has since forgotten about.
 */
export const useOpenPullRequestBarStore = create<OpenPullRequestBarState>((set) => ({
	dismissed: {},
	dismiss: (key) =>
		set((state) => (state.dismissed[key] ? state : { dismissed: { ...state.dismissed, [key]: true } })),
}))
