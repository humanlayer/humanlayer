import { useIsMobile } from '@humanlayer/ui/hooks/use-mobile'
import { type HistoryState, type RouterHistory, useRouter } from '@tanstack/react-router'
import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { MAX_HORIZONTAL_TABS, type HorizontalTab, useHorizontalTabsStore } from '@/hooks/stores/horizontalTabsStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isDesktop } from '@/lib/utils'

import {
	findHorizontalTabForNotification,
	type HorizontalTabNotificationDestination,
} from './horizontalTabNotificationDestination'

export type HorizontalTabsContextValue = {
	isAvailable: boolean
	tabs: HorizontalTab[]
	selectedTabId: string | null
	canCreateTab: boolean
	createTasksTab: () => void
	selectTab: (tabId: string) => void
	selectAdjacentTab: (direction: -1 | 1) => void
	closeTab: (tabId: string) => void
	openNotificationDestination: (destination: HorizontalTabNotificationDestination) => void
	openIncomingDestination: (href: string) => void
}

const unavailableHorizontalTabs: HorizontalTabsContextValue = {
	isAvailable: false,
	tabs: [],
	selectedTabId: null,
	canCreateTab: false,
	createTasksTab: () => undefined,
	selectTab: () => undefined,
	selectAdjacentTab: () => undefined,
	closeTab: () => undefined,
	openNotificationDestination: () => undefined,
	openIncomingDestination: () => undefined,
}

export const HorizontalTabsContext = createContext<HorizontalTabsContextValue>(unavailableHorizontalTabs)

export function useHorizontalTabs(): HorizontalTabsContextValue {
	return use(HorizontalTabsContext)
}

function hasAuthorizationCallbackParams(href: string): boolean {
	const search = href.slice(href.indexOf('?') + 1).split('#', 1)[0]
	if (!search || search === href) return false

	const params = new URLSearchParams(search)
	return params.has('code') || params.has('state') || params.has('error')
}

function isAuthenticationRoute(href: string): boolean {
	return /^\/auth(?:[/?#]|$)/.test(href)
}

function updateHorizontalTabFromHistory(tabId: string, href: string): void {
	const { selectedTabId, tabs } = useHorizontalTabsStore.getState()
	const tab = tabs.find((candidate) => candidate.id === tabId)
	if (!tab || (selectedTabId === tabId && tab.href === href)) return

	useHorizontalTabsStore.setState({
		selectedTabId: tabId,
		tabs: tabs.map((tab) => (tab.id === tabId && tab.href !== href ? { ...tab, href } : tab)),
	})
}

function synchronizeHorizontalTabHistoryLocation(
	location: { href: string; state: HistoryState },
	history: RouterHistory,
): void {
	if (isAuthenticationRoute(location.href)) return

	const store = useHorizontalTabsStore.getState()
	const historyTabId = location.state.nativeTabId
	if (historyTabId && store.tabs.some((tab) => tab.id === historyTabId)) {
		updateHorizontalTabFromHistory(historyTabId, location.href)
		return
	}

	if (!store.selectedTabId) return
	store.updateSelectedTabHref(location.href)
	if (history.location.state.nativeTabId !== store.selectedTabId) {
		history.replace(location.href, location.state, { ignoreBlocker: true })
	}
}

function DesktopHorizontalTabsProvider({ children }: { children: ReactNode }) {
	const router = useRouter()
	const tabs = useHorizontalTabsStore((state) => state.tabs)
	const selectedTabId = useHorizontalTabsStore((state) => state.selectedTabId)
	const hasHydrated = useHorizontalTabsStore((state) => state.hasHydrated)
	const [isReady, setIsReady] = useState(false)
	const isReadyRef = useRef(false)

	useMountEffect(() => {
		let cancelled = false
		const restore = async () => {
			const currentHref = router.state.location.href
			const tab = useHorizontalTabsStore.getState().initializeHorizontalTabs(currentHref)
			try {
				// Auth owns these routes. Restoring a protected tab here causes a loop:
				// auth redirects to sign-in, remounting this provider, which restores again.
				if (
					!isAuthenticationRoute(currentHref) &&
					!hasAuthorizationCallbackParams(currentHref) &&
					tab.href !== currentHref
				) {
					await router.navigate({ href: tab.href, replace: true })
				}
			} finally {
				if (!cancelled) {
					isReadyRef.current = true
					synchronizeHorizontalTabHistoryLocation(router.state.location, router.history)
					setIsReady(true)
				}
			}
		}
		const stopHydrationListener = useHorizontalTabsStore.getState().hasHydrated
			? undefined
			: useHorizontalTabsStore.persist.onFinishHydration(() => void restore())
		if (stopHydrationListener === undefined) void restore()

		const unsubscribe = router.subscribe('onResolved', (event) => {
			if (isReadyRef.current) synchronizeHorizontalTabHistoryLocation(event.toLocation, router.history)
		})
		return () => {
			cancelled = true
			stopHydrationListener?.()
			unsubscribe()
		}
	})

	const createTasksTab = useCallback(() => {
		const tab = useHorizontalTabsStore
			.getState()
			.appendAndSelectTab('/sessions?tab=tasks', router.state.location.href)
		if (!tab) {
			toast.error(`A maximum of ${MAX_HORIZONTAL_TABS} tabs can be open at once.`)
			return
		}
		void router.navigate({ href: tab.href, replace: true })
	}, [router])

	const selectTab = useCallback(
		(tabId: string) => {
			const tab = useHorizontalTabsStore.getState().selectTab(tabId, router.state.location.href)
			if (tab) void router.navigate({ href: tab.href, replace: true })
		},
		[router],
	)

	const selectAdjacentTab = useCallback(
		(direction: -1 | 1) => {
			const store = useHorizontalTabsStore.getState()
			const selectedIndex = store.tabs.findIndex((tab) => tab.id === store.selectedTabId)
			const adjacentTab = store.tabs[selectedIndex + direction]
			if (!adjacentTab) return

			const tab = store.selectTab(adjacentTab.id, router.state.location.href)
			if (tab) void router.navigate({ href: tab.href, replace: true })
		},
		[router],
	)

	const closeTab = useCallback(
		(tabId: string) => {
			const nextTab = useHorizontalTabsStore.getState().closeTab(tabId, router.state.location.href)
			if (nextTab) void router.navigate({ href: nextTab.href, replace: true })
		},
		[router],
	)

	const openNotificationDestination = useCallback(
		(destination: HorizontalTabNotificationDestination) => {
			const store = useHorizontalTabsStore.getState()
			const currentHref = router.state.location.href
			const matchingTab = findHorizontalTabForNotification(store.tabs, destination)
			if (matchingTab) {
				store.selectTab(matchingTab.id, currentHref)
				void router.navigate({ href: destination.href, replace: true })
				return
			}

			const tab = store.appendAndSelectTab(destination.href, currentHref)
			if (tab) {
				void router.navigate({ href: tab.href, replace: true })
				return
			}

			void router.navigate({ href: destination.href })
		},
		[router],
	)

	const openIncomingDestination = useCallback(
		(href: string) => {
			const store = useHorizontalTabsStore.getState()
			const currentHref = router.state.location.href
			const matchingTab = store.tabs.find((tab) => tab.href === href)
			if (matchingTab) {
				store.selectTab(matchingTab.id, currentHref)
				void router.navigate({ href, replace: true })
				return
			}

			const tab = store.appendAndSelectTab(href, currentHref)
			if (tab) {
				void router.navigate({ href: tab.href, replace: true })
				return
			}

			store.updateSelectedTabHref(href)
			void router.navigate({ href, replace: true })
		},
		[router],
	)

	const value = useMemo<HorizontalTabsContextValue>(
		() => ({
			isAvailable: true,
			tabs,
			selectedTabId,
			canCreateTab: tabs.length < MAX_HORIZONTAL_TABS,
			createTasksTab,
			selectTab,
			selectAdjacentTab,
			closeTab,
			openNotificationDestination,
			openIncomingDestination,
		}),
		[
			tabs,
			selectedTabId,
			createTasksTab,
			selectTab,
			selectAdjacentTab,
			closeTab,
			openNotificationDestination,
			openIncomingDestination,
		],
	)

	if (!hasHydrated || !isReady) return null

	return <HorizontalTabsContext.Provider value={value}>{children}</HorizontalTabsContext.Provider>
}

export function HorizontalTabsProvider({ children }: { children: ReactNode }) {
	const isMobile = useIsMobile()
	if (!isDesktop() || isMobile) {
		return (
			<HorizontalTabsContext.Provider value={unavailableHorizontalTabs}>
				{children}
			</HorizontalTabsContext.Provider>
		)
	}

	return <DesktopHorizontalTabsProvider>{children}</DesktopHorizontalTabsProvider>
}
