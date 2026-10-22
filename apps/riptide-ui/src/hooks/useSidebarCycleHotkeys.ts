import type { SidebarTab } from '@/components/sidebar-widget/sidebar-tabs'

import type { HotkeyScope } from './hotkeys/scopes'
import { useAppHotkeys } from './hotkeys/useAppHotkeys'

export interface UseSidebarCycleHotkeysOptions {
	visibleTabs: SidebarTab[]
	currentTab: SidebarTab
	isCollapsed: () => boolean
	scopes: HotkeyScope[]
	enabled: boolean
	onTabChange: (tab: SidebarTab) => void
	onCollapse: () => void
	onExpand: () => void
	/** Called after a cycle that leaves the sidebar open, so callers can focus it. */
	onFocusSidebar: () => void
	/** Called after a cycle that collapses the sidebar, so callers can focus main. */
	onFocusMain: () => void
}

export function useSidebarCycleHotkeys({
	visibleTabs,
	currentTab,
	isCollapsed,
	scopes,
	enabled,
	onTabChange,
	onCollapse,
	onExpand,
	onFocusSidebar,
	onFocusMain,
}: UseSidebarCycleHotkeysOptions) {
	const firstTab = visibleTabs[0]
	const lastTab = visibleTabs[visibleTabs.length - 1]
	const cycleForward = () => {
		if (isCollapsed()) {
			onExpand()
			if (firstTab) onTabChange(firstTab)
			onFocusSidebar()
			return
		}
		const currentIndex = visibleTabs.indexOf(currentTab)
		const isLastTab = currentIndex >= visibleTabs.length - 1 || currentIndex === -1
		if (isLastTab) {
			onCollapse()
			onFocusMain()
		} else {
			const nextTab = visibleTabs[currentIndex + 1]
			if (nextTab === undefined) return
			onTabChange(nextTab)
			onFocusSidebar()
		}
	}
	const cycleBackward = () => {
		if (isCollapsed()) {
			onExpand()
			if (lastTab) onTabChange(lastTab)
			onFocusSidebar()
			return
		}
		const currentIndex = visibleTabs.indexOf(currentTab)
		const isFirstTab = currentIndex <= 0
		if (isFirstTab) {
			onCollapse()
			onFocusMain()
		} else {
			const prevTab = visibleTabs[currentIndex - 1]
			if (prevTab === undefined) return
			onTabChange(prevTab)
			onFocusSidebar()
		}
	}

	// s - cycle sidebar tabs forward
	// Cycles: first tab → ... → last tab → collapsed → first tab
	useAppHotkeys('s', cycleForward, { preventDefault: true, scopes, enabled }, [enabled, cycleForward])

	// shift+s - cycle sidebar tabs backward
	// Cycles: collapsed → last tab → ... → first tab → collapsed
	useAppHotkeys('shift+s', cycleBackward, { preventDefault: true, scopes, enabled }, [enabled, cycleBackward])

	return { cycleForward, cycleBackward }
}
