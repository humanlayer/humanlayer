import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { getHorizontalTabsStorage } from '@/integrations/desktop/window'

export const MAX_HORIZONTAL_TABS = 9
export const HORIZONTAL_TABS_STORAGE_KEY = 'riptide-horizontal-tabs'
const LEGACY_HORIZONTAL_TABS_STORAGE_KEY = 'riptide-native-tabs'

export type HorizontalTab = {
	id: string
	href: string
}

type PersistedHorizontalTabsState = {
	tabs: HorizontalTab[]
	selectedTabId: string | null
}

type HorizontalTabsState = PersistedHorizontalTabsState & {
	hasHydrated: boolean
	setHasHydrated: (hasHydrated: boolean) => void
	initializeHorizontalTabs: (currentHref: string) => HorizontalTab
	appendAndSelectTab: (href: string, currentHref: string) => HorizontalTab | null
	selectTab: (tabId: string, currentHref: string) => HorizontalTab | null
	closeTab: (tabId: string, currentHref: string) => HorizontalTab | null
	updateSelectedTabHref: (href: string) => void
}

function createHorizontalTab(href: string): HorizontalTab {
	return {
		id: globalThis.crypto?.randomUUID?.() ?? `horizontal-tab-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		href,
	}
}

function isHorizontalTab(value: unknown): value is HorizontalTab {
	if (!value || typeof value !== 'object') return false
	const tab = value as { id?: unknown; href?: unknown }
	return typeof tab.id === 'string' && tab.id.length > 0 && typeof tab.href === 'string' && tab.href.startsWith('/')
}

function parsePersistedState(value: unknown): PersistedHorizontalTabsState | null {
	if (!value || typeof value !== 'object') return null
	const state = value as { tabs?: unknown; selectedTabId?: unknown }
	if (!Array.isArray(state.tabs) || state.tabs.length === 0 || state.tabs.length > MAX_HORIZONTAL_TABS) return null
	if (!state.tabs.every(isHorizontalTab)) return null

	const tabs = state.tabs
	if (new Set(tabs.map((tab) => tab.id)).size !== tabs.length) return null

	const selectedTabId =
		typeof state.selectedTabId === 'string' && tabs.some((tab) => tab.id === state.selectedTabId)
			? state.selectedTabId
			: (tabs.at(-1)?.id ?? null)

	return { tabs, selectedTabId }
}

function withCurrentHref(state: PersistedHorizontalTabsState, currentHref: string): HorizontalTab[] {
	if (!state.selectedTabId) return state.tabs
	return state.tabs.map((tab) => (tab.id === state.selectedTabId ? { ...tab, href: currentHref } : tab))
}

function horizontalTabsStorage(): Storage {
	const storage = getHorizontalTabsStorage()
	return {
		get length() {
			return storage.length
		},
		clear: () => storage.clear(),
		getItem: (key) => {
			const persistedState = storage.getItem(key)
			if (key !== HORIZONTAL_TABS_STORAGE_KEY || persistedState !== null) return persistedState

			const legacyState = storage.getItem(LEGACY_HORIZONTAL_TABS_STORAGE_KEY)
			if (legacyState === null) return null

			storage.setItem(HORIZONTAL_TABS_STORAGE_KEY, legacyState)
			storage.removeItem(LEGACY_HORIZONTAL_TABS_STORAGE_KEY)
			return legacyState
		},
		key: (index) => storage.key(index),
		removeItem: (key) => storage.removeItem(key),
		setItem: (key, value) => storage.setItem(key, value),
	}
}

export const useHorizontalTabsStore = create<HorizontalTabsState>()(
	persist(
		(set, get) => ({
			tabs: [],
			selectedTabId: null,
			hasHydrated: false,
			setHasHydrated: (hasHydrated) => set({ hasHydrated }),
			initializeHorizontalTabs: (currentHref) => {
				const state = get()
				const selected = state.tabs.find((tab) => tab.id === state.selectedTabId)
				if (selected) return selected

				const tab = createHorizontalTab(currentHref)
				set({ tabs: [tab], selectedTabId: tab.id })
				return tab
			},
			appendAndSelectTab: (href, currentHref) => {
				const state = get()
				if (state.tabs.length >= MAX_HORIZONTAL_TABS) return null

				const tab = createHorizontalTab(href)
				set({
					tabs: [...withCurrentHref(state, currentHref), tab],
					selectedTabId: tab.id,
				})
				return tab
			},
			selectTab: (tabId, currentHref) => {
				const state = get()
				const tab = state.tabs.find((candidate) => candidate.id === tabId)
				if (!tab || tab.id === state.selectedTabId) return null

				set({ tabs: withCurrentHref(state, currentHref), selectedTabId: tab.id })
				return tab
			},
			closeTab: (tabId, currentHref) => {
				const state = get()
				if (state.tabs.length <= 1) return null
				const tabIndex = state.tabs.findIndex((tab) => tab.id === tabId)
				if (tabIndex < 0) return null

				const tabsWithCurrentHref = withCurrentHref(state, currentHref)
				const isClosingSelectedTab = tabId === state.selectedTabId
				const remainingTabs = tabsWithCurrentHref.filter((tab) => tab.id !== tabId)
				if (!isClosingSelectedTab) {
					set({ tabs: remainingTabs })
					return null
				}

				const selectedTab = remainingTabs[tabIndex - 1] ?? remainingTabs[tabIndex]
				if (!selectedTab) return null
				set({ tabs: remainingTabs, selectedTabId: selectedTab.id })
				return selectedTab
			},
			updateSelectedTabHref: (href) => {
				const state = get()
				if (!state.selectedTabId) return
				const selectedTab = state.tabs.find((tab) => tab.id === state.selectedTabId)
				if (!selectedTab || selectedTab.href === href) return
				set({ tabs: withCurrentHref(state, href) })
			},
		}),
		{
			name: HORIZONTAL_TABS_STORAGE_KEY,
			version: 1,
			storage: createJSONStorage(horizontalTabsStorage),
			partialize: (state) => ({ tabs: state.tabs, selectedTabId: state.selectedTabId }),
			migrate: () => ({ tabs: [], selectedTabId: null }),
			merge: (persistedState, currentState) => {
				const parsed = parsePersistedState(persistedState)
				const persistedTabs = parsed ?? { tabs: [], selectedTabId: null }
				return {
					...currentState,
					...persistedTabs,
				}
			},
			onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
		},
	),
)
