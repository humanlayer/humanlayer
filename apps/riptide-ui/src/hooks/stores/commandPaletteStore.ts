import type React from 'react'
import { create } from 'zustand'

import type { ShortcutDisplay } from '@/hotkeysCatalog'

export interface CommandPaletteAction {
	id: string
	label: string
	icon?: React.ComponentType<{ className?: string }>
	shortcut?: string | ShortcutDisplay
	enabled?: boolean
	onSelect: () => void
}

interface CommandPaletteState {
	// Palette visibility
	isOpen: boolean
	open: () => void
	close: () => void
	toggle: () => void

	// Search input
	searchValue: string
	setSearchValue: (value: string) => void

	// Search filter
	searchIncludeShared: boolean
	setSearchIncludeShared: (value: boolean) => void

	// Session context (synced from sessions table/detail views)
	selectedSessionIds: Set<string>

	// Sessions table tab tracking (null when not on sessions page)
	activeSessionsTab: 'live' | null

	// Session context actions
	setActiveSessionsTab: (tab: 'live' | null) => void

	// Reset session context (e.g., on tab change or navigation away)
	resetSessionContext: () => void

	// Action registry
	actions: Map<string, CommandPaletteAction>
	registerAction: (action: CommandPaletteAction) => void
	unregisterAction: (id: string) => void
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
	// Palette visibility
	isOpen: false,
	open: () => {
		set({ isOpen: true })
	},
	close: () => set({ isOpen: false, searchValue: '' }),
	toggle: () => set((state) => (state.isOpen ? { isOpen: false, searchValue: '' } : { isOpen: true })),

	// Search input
	searchValue: '',
	setSearchValue: (value) => set({ searchValue: value }),

	// Search filter
	searchIncludeShared: true,
	setSearchIncludeShared: (value) => set({ searchIncludeShared: value }),

	// Session context
	selectedSessionIds: new Set(),
	activeSessionsTab: null,

	setActiveSessionsTab: (tab) => set({ activeSessionsTab: tab }),

	resetSessionContext: () =>
		set({
			activeSessionsTab: null,
		}),

	// Action registry
	actions: new Map<string, CommandPaletteAction>(),
	registerAction: (action) =>
		set((state) => {
			const next = new Map(state.actions)
			next.set(action.id, action)
			return { actions: next }
		}),
	unregisterAction: (id) =>
		set((state) => {
			const next = new Map(state.actions)
			next.delete(id)
			return { actions: next }
		}),
}))
