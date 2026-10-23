/**
 * Registers hotkeys at the root scope level.
 * These hotkeys are available from anywhere in the app
 * as long as the root scope is not disabled.
 *
 * Note: The 'c' hotkey for creating sessions was moved to page-specific
 * handlers to avoid race conditions and enable context-aware behavior
 * (e.g., passing taskId from session/task detail pages).
 */
export function RootScopeHotkeysProvider() {
	const { closeTab, createTasksTab, isAvailable, selectTab, selectedTabId, tabs } = useHorizontalTabs()

	useAppHotkeys(
		'mod+t',
		(event) => {
			event.preventDefault()
			createTasksTab()
		},
		{
			scopes: [HOTKEY_SCOPES.ROOT],
			enabled: isAvailable,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[createTasksTab, isAvailable],
	)

	useAppHotkeys(
		'mod+w',
		(event) => {
			event.preventDefault()
			if (selectedTabId) closeTab(selectedTabId)
		},
		{
			scopes: [HOTKEY_SCOPES.ROOT],
			enabled: isAvailable,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[closeTab, isAvailable, selectedTabId],
	)

	useAppHotkeys(
		'mod+1, mod+2, mod+3, mod+4, mod+5, mod+6, mod+7, mod+8, mod+9',
		(event) => {
			event.preventDefault()
			const index = Number(event.key) - 1
			const tab = Number.isInteger(index) ? tabs[index] : undefined
			if (tab) selectTab(tab.id)
		},
		{
			scopes: [HOTKEY_SCOPES.ROOT],
			enabled: isAvailable,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[isAvailable, selectTab, tabs],
	)

	return null
}
import { useHorizontalTabs } from '@/components/horizontal-tabs/HorizontalTabsProvider'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
