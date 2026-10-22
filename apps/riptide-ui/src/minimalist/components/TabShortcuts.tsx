import { useAppHotkeys } from '@/hooks/hotkeys/useAppHotkeys'
import { hotkeysCatalog } from '@/hotkeysCatalog'
import { useMinimalistTabs } from '@/minimalist/lib/tabs'

/**
 * These stay active in settings, composers and menus, even when focus is outside the app shell.
 * No scopes: a hotkey scoped to '*' only fires while '*' is active, and the standard UI's scope
 * boundaries replace it with their own, so switching interfaces in one window used to kill ⌘T.
 */
export function TabShortcuts() {
	const { isAvailable, createTab, closeTab, selectedTabId, tabs, selectTab, selectAdjacentTab } = useMinimalistTabs()
	const options = {
		enabled: isAvailable,
		enableOnFormTags: true,
		enableOnContentEditable: true,
		preventDefault: true,
		useKey: false,
		ignoreEventWhen: (event: KeyboardEvent) => event.defaultPrevented || event.isComposing || event.repeat,
	}
	useAppHotkeys('mod+t', createTab, options)
	useAppHotkeys(
		'mod+w',
		() => {
			if (selectedTabId) closeTab(selectedTabId)
		},
		options,
	)
	useAppHotkeys(
		'mod+1,mod+2,mod+3,mod+4,mod+5,mod+6,mod+7,mod+8,mod+9',
		(event) => {
			const digit = Number(event.code.match(/^Digit([1-9])$/)?.[1])
			const tab = tabs[digit - 1]
			if (tab) selectTab(tab.id)
		},
		options,
	)
	useAppHotkeys(
		// Physical names match Shift+[ / Shift+] even when event.key reports { / }.
		hotkeysCatalog.global.shortcuts.previousHorizontalTab.reactHotkeys.replace('[', 'bracketleft'),
		() => selectAdjacentTab(-1),
		options,
	)
	useAppHotkeys(
		hotkeysCatalog.global.shortcuts.nextHorizontalTab.reactHotkeys.replace(']', 'bracketright'),
		() => selectAdjacentTab(1),
		options,
	)
	return null
}
