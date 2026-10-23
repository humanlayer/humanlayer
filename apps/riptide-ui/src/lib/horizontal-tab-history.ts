import type { HistoryState, RouterHistory } from '@tanstack/react-router'

declare module '@tanstack/react-router' {
	interface HistoryState {
		nativeTabId?: string
	}
}

function withHorizontalTabId(state: HistoryState | undefined, nativeTabId: string): HistoryState {
	const previousState = state ?? {}
	return {
		...previousState,
		nativeTabId,
	}
}

export function createHorizontalTabHistory(
	history: RouterHistory,
	getSelectedTabId: () => string | null,
): RouterHistory {
	return {
		get location() {
			return history.location
		},
		get length() {
			return history.length
		},
		get _ignoreSubscribers() {
			return history._ignoreSubscribers
		},
		set _ignoreSubscribers(value) {
			history._ignoreSubscribers = value
		},
		subscribers: history.subscribers,
		subscribe: (subscriber) => history.subscribe(subscriber),
		push: (path, state, navigateOptions) => {
			const selectedTabId = getSelectedTabId()
			history.push(
				path,
				selectedTabId === null ? state : withHorizontalTabId(state, selectedTabId),
				navigateOptions,
			)
		},
		replace: (path, state, navigateOptions) => {
			const selectedTabId = getSelectedTabId()
			history.replace(
				path,
				selectedTabId === null ? state : withHorizontalTabId(state, selectedTabId),
				navigateOptions,
			)
		},
		go: (index, navigateOptions) => history.go(index, navigateOptions),
		back: (navigateOptions) => history.back(navigateOptions),
		forward: (navigateOptions) => history.forward(navigateOptions),
		canGoBack: () => history.canGoBack(),
		createHref: (href) => history.createHref(href),
		block: (blocker) => history.block(blocker),
		flush: () => history.flush(),
		destroy: () => history.destroy(),
		notify: (action) => history.notify(action),
	}
}
