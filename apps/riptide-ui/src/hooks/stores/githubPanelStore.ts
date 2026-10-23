import { useEffect } from 'react'
import { create } from 'zustand'

/** `warning`: a push happened and GitHub is not connected; `accent`: the push's pull request exists. */
export type GitHubPanelAttention = 'warning' | 'accent'

interface GitHubPanelState {
	/** Failing-check count per reachable section, keyed per panel scope, repository and branch. */
	sections: Record<string, number>
	/** The dot on the GitHub tab per panel scope, until the reader opens the tab. */
	attention: Record<string, GitHubPanelAttention | null>
	report: (key: string, failingCheckCount: number) => void
	forget: (key: string) => void
	setAttention: (scopeKey: string, attention: GitHubPanelAttention | null) => void
	clearAttention: (scopeKey: string) => void
}

export const useGitHubPanelStore = create<GitHubPanelState>((set) => ({
	sections: {},
	attention: {},
	report: (key, failingCheckCount) =>
		set((state) =>
			state.sections[key] === failingCheckCount
				? state
				: { sections: { ...state.sections, [key]: failingCheckCount } },
		),
	forget: (key) =>
		set((state) => {
			if (!(key in state.sections)) return state
			const { [key]: _forgotten, ...sections } = state.sections
			return { sections }
		}),
	setAttention: (scopeKey, attention) =>
		set((state) =>
			state.attention[scopeKey] === attention
				? state
				: { attention: { ...state.attention, [scopeKey]: attention } },
		),
	clearAttention: (scopeKey) =>
		set((state) => {
			if (!(scopeKey in state.attention)) return state
			const { [scopeKey]: _cleared, ...attention } = state.attention
			return { attention }
		}),
}))

const KEY_SEPARATOR = ':'

export const githubPanelSectionKey = (scopeKey: string, branchKey: string): string =>
	`${scopeKey}${KEY_SEPARATOR}${branchKey}`

/** The badge for a panel's tab: the failing checks across every section reporting under its scope. */
export const countGitHubPanelFailingChecks = (sections: Record<string, number>, scopeKey: string): number => {
	const prefix = `${scopeKey}${KEY_SEPARATOR}`
	let failingCheckCount = 0
	for (const [key, count] of Object.entries(sections)) {
		if (key.startsWith(prefix)) failingCheckCount += count
	}
	return failingCheckCount
}

export function useGitHubPanelFailingChecks(scopeKey: string): number {
	return useGitHubPanelStore((state) => countGitHubPanelFailingChecks(state.sections, scopeKey))
}

export function useGitHubPanelAttention(scopeKey: string): GitHubPanelAttention | null {
	return useGitHubPanelStore((state) => state.attention[scopeKey] ?? null)
}

export interface GitHubPanelSectionReport {
	readonly available: boolean
	readonly failingCheckCount: number
}

export function useReportGitHubPanelSection(key: string, report: GitHubPanelSectionReport): void {
	const { available, failingCheckCount } = report
	useEffect(() => {
		const store = useGitHubPanelStore.getState()
		if (available) store.report(key, failingCheckCount)
		else store.forget(key)
		return () => useGitHubPanelStore.getState().forget(key)
	}, [key, available, failingCheckCount])
}

/**
 * The push card's dot on the tab. A card that renders nothing reports null, which withdraws the
 * dot; a tab the reader opens clears it from the sidebar side, and this does not put it back
 * until the attention itself changes.
 */
export function useReportGitHubPanelAttention(scopeKey: string, attention: GitHubPanelAttention | null): void {
	useEffect(() => {
		if (attention === null) return
		useGitHubPanelStore.getState().setAttention(scopeKey, attention)
		return () => useGitHubPanelStore.getState().clearAttention(scopeKey)
	}, [scopeKey, attention])
}
