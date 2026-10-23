import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

import type { SessionsTab } from '@/components/sessions-page/SessionsPage'

import type { HotkeyScope } from './hotkeys/scopes'

export interface UseSessionsPageHotkeysOptions {
	scope: HotkeyScope
	enabled?: boolean
	isEditing?: boolean
	isCommandPaletteOpen?: boolean
	activeTab: SessionsTab
	showContextShards?: boolean

	// Tab callbacks
	onTabChange: (tab: SessionsTab) => void

	// Create callbacks
	onCreateSession: () => void
	onCreateTask?: () => void
}

export function useSessionsPageHotkeys({
	scope,
	enabled = true,
	isEditing = false,
	isCommandPaletteOpen = false,
	activeTab,
	showContextShards = false,
	onTabChange,
	onCreateSession,
	onCreateTask,
}: UseSessionsPageHotkeysOptions) {
	const isHotkeysEnabled = enabled && !isEditing && !isCommandPaletteOpen

	const tabs: SessionsTab[] = showContextShards
		? ['tasks', 'sessions', 'drafts', 'context-shards']
		: ['tasks', 'sessions', 'drafts']

	// 1 - Switch to Tasks tab
	useHotkeys(
		'1',
		() => onTabChange('tasks'),
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
		},
		[onTabChange, isHotkeysEnabled],
	)

	// 2 - Switch to Sessions tab
	useHotkeys(
		'2',
		() => onTabChange('sessions'),
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
		},
		[onTabChange, isHotkeysEnabled],
	)

	// 3 - Switch to Drafts tab
	useHotkeys(
		'3',
		() => onTabChange('drafts'),
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
		},
		[onTabChange, isHotkeysEnabled],
	)

	// Tab - Cycle to next tab
	useHotkeys(
		'tab',
		(e) => {
			e.preventDefault()
			const currentIndex = tabs.indexOf(activeTab)
			const nextIndex = (currentIndex + 1) % tabs.length
			const nextTab = tabs[nextIndex]
			if (nextTab === undefined) return
			onTabChange(nextTab)
		},
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
		},
		[activeTab, onTabChange, isHotkeysEnabled],
	)

	// Shift+Tab - Cycle to previous tab
	useHotkeys(
		'shift+tab',
		(e) => {
			e.preventDefault()
			const currentIndex = tabs.indexOf(activeTab)
			const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length
			const prevTab = tabs[prevIndex]
			if (prevTab === undefined) return
			onTabChange(prevTab)
		},
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
		},
		[activeTab, onTabChange, isHotkeysEnabled],
	)

	// c - Create new session
	useHotkeys(
		'c',
		() => onCreateSession(),
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[onCreateSession, isHotkeysEnabled],
	)

	// t - Create new task
	useHotkeys(
		't',
		(e) => {
			e.stopPropagation()
			onCreateTask?.()
		},
		{
			scopes: [scope],
			enabled: isHotkeysEnabled,
			preventDefault: true,
			enableOnFormTags: false,
		},
		[onCreateTask, isHotkeysEnabled],
	)
}
