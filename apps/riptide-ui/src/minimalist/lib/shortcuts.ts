/**
 * App-wide shortcuts. The settings page lists these, and the shell and thread run them by matching
 * the same key strings, so the list can't drift from what the keys do.
 */
export const SHORTCUTS = [
	{ id: 'new-task', group: 'App', label: 'New task', keys: '⌘ N' },
	{ id: 'search', group: 'App', label: 'Search tasks and actions', keys: '⌘ K' },
	{ id: 'settings', group: 'App', label: 'Settings', keys: '⌘ ,' },
	{ id: 'sidebar', group: 'App', label: 'Show or hide the sidebar', keys: '⌘ B' },
	{ id: 'panel', group: 'App', label: 'Show or hide the side panel', keys: '⌥ ⌘ B' },
	{ id: 'new-tab', group: 'Tabs', label: 'Create tab', keys: '⌘ T' },
	{ id: 'close-tab', group: 'Tabs', label: 'Close tab', keys: '⌘ W' },
	{ id: 'tab', group: 'Tabs', label: 'Select tab', keys: '⌘ 1–9' },
	{ id: 'previous-tab', group: 'Tabs', label: 'Move one tab left', keys: '⇧ ⌘ [' },
	{ id: 'next-tab', group: 'Tabs', label: 'Move one tab right', keys: '⇧ ⌘ ]' },
	{ id: 'back', group: 'Navigation', label: 'Back', keys: '⌘ [' },
	{ id: 'forward', group: 'Navigation', label: 'Forward', keys: '⌘ ]' },
	{ id: 'next-task', group: 'Navigation', label: 'Next task', keys: '⌥ ⌘ ]' },
	{ id: 'previous-task', group: 'Navigation', label: 'Previous task', keys: '⌥ ⌘ [' },
	{ id: 'recent', group: 'Navigation', label: 'Recent tasks', keys: '⌥ ⌘ 1–6' },
	{ id: 'archive', group: 'Task', label: 'Archive the open task', keys: '⇧ ⌘ A' },
	{ id: 'mark-unread', group: 'Task', label: 'Mark the open task as unread', keys: '⇧ ⌘ U' },
	{ id: 'fork', group: 'Task', label: 'Fork from your last message', keys: '⌘ Y' },
	{ id: 'terminal', group: 'Task', label: 'Show or hide the terminal', keys: '⌘ J' },
	{ id: 'attention', group: 'Attention', label: 'What needs you', keys: '⌥ ⌘ U' },
	{ id: 'next-attention', group: 'Attention', label: 'Open next notification', keys: '⌥ ⌘ A' },
] as const

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

/** The keys as a compact hint, like ⇧⌘A. */
export function shortcutHint(id: ShortcutId): string {
	return SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys.replaceAll(' ', '') ?? ''
}

// Option and Shift change what event.key reports on a Mac (⌥B is ∫, ⇧[ is {), so those fall back to the physical key.
const CODES = new Map([
	[',', 'Comma'],
	['[', 'BracketLeft'],
	[']', 'BracketRight'],
])

type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/** The shortcut a key press matches, with the digit pressed for a range like ⌥⌘1–6 (0 otherwise). */
export function matchShortcut(event: KeyPress): { id: ShortcutId; digit: number } | null {
	if (!event.metaKey && !event.ctrlKey) return null
	if (event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Tab')
		return { id: event.shiftKey ? 'previous-tab' : 'next-tab', digit: 0 }
	for (const shortcut of SHORTCUTS) {
		const tokens = shortcut.keys.split(' ')
		if (tokens.includes('⇧') !== event.shiftKey || tokens.includes('⌥') !== event.altKey) continue
		const key = (tokens.at(-1) ?? '').toLowerCase()
		const range = key.match(/^(\d)–(\d)$/)
		if (range) {
			const digit = Number(event.code.match(/^Digit(\d)$/)?.[1] ?? 0)
			if (digit >= Number(range[1]) && digit <= Number(range[2])) return { id: shortcut.id, digit }
			continue
		}
		const code = CODES.get(key) ?? `Key${key.toUpperCase()}`
		if (event.key.toLowerCase() === key || ((event.altKey || event.shiftKey) && event.code === code))
			return { id: shortcut.id, digit: 0 }
	}
	return null
}
