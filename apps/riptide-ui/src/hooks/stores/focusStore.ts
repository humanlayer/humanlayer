import type { SidebarItem } from '@humanlayer/ui/components/sidebar/types'
import { create } from 'zustand'

import { FOCUSED_AREAS, type FocusedArea } from './focus-areas'

export type { FocusedArea } from './focus-areas'

export interface FocusHotkeyDebugEvent {
	key: string
	outcome: 'fired' | 'rejected'
	reason: string
	target: string
	eventTimeStamp: number | null
}

export type { SidebarItem }

export interface DraftItem {
	id: string
}

interface FocusState {
	// Conversation events (existing)
	focusedEventId: string | null
	// Session table
	focusedSessionId: string | null
	// Task table
	focusedTaskId: string | null
	// Task draft table (drafts tab)
	focusedTaskDraftId: string | null
	// Archive page cursors
	focusedArchivedSessionId: string | null
	focusedArchivedTaskId: string | null
	// Inline title editing in the session tables (sessions list page)
	editingSessionId: string | null
	// Shared source tracking
	focusSource: 'mouse' | 'keyboard' | null
	// Whether the reader's last artifact-document keypress was a navigation key
	// (h/j/k/l). Drives the floating hotkey legend over the keyboard-focus cursor:
	// it shows after navigation and hides on any action key or mouse-driven focus.
	lastNavWasHotkey: boolean
	lastHotkeyDebug: FocusHotkeyDebugEvent | null
	// Spatial keyboard ownership. Editable DOM focus is derived live and is not stored here.
	focusedArea: FocusedArea
	// Whether the session prompt composer's editor has DOM focus. Written by the
	// composer, read by hotkey gating and row-highlight styling.
	isEditorFocused: boolean
	// Sidebar item-level navigation
	focusedSidebarItem: SidebarItem | null

	setFocusedEventId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedSessionId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedTaskId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedTaskDraftId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedArchivedSessionId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedArchivedTaskId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setEditingSessionId: (id: string | null) => void
	// Set whether the last artifact-document keypress was a navigation key.
	setLastNavWasHotkey: (value: boolean) => void
	setLastHotkeyDebug: (event: FocusHotkeyDebugEvent) => void
	// Enable mouse focus without changing focus IDs - call on mouse move
	enableMouseFocus: () => void
	clearFocus: () => void
	// Focus area transitions
	focusSidebar: () => void
	focusMain: () => void
	focusRightPane: () => void
	moveFocusLeft: (rightPaneAvailable: boolean) => void
	moveFocusRight: (rightPaneAvailable: boolean) => void
	setIsEditorFocused: (value: boolean) => void
	// Sidebar item focus
	setFocusedSidebarItem: (item: SidebarItem | null) => void
	/** Move focus after a task and its visible descendant sessions are removed. */
	focusAfterSidebarTaskRemoved: (items: SidebarItem[], taskId: string) => void
	// Sidebar cycling - pass navigable items when calling
	focusNextSidebarItem: (items: SidebarItem[]) => void
	focusPrevSidebarItem: (items: SidebarItem[]) => void
	focusFirstSidebarItem: (items: SidebarItem[]) => void
	focusLastSidebarItem: (items: SidebarItem[]) => void
	// Drafts tab cross-table navigation
	focusNextDraft: (taskDrafts: DraftItem[], sessionDrafts: DraftItem[]) => void
	focusPrevDraft: (taskDrafts: DraftItem[], sessionDrafts: DraftItem[]) => void
}

const findItemIndex = (items: SidebarItem[], item: SidebarItem | null): number => {
	if (!item) return -1
	return items.findIndex((i) => i.type === item.type && i.id === item.id)
}

export const useFocusStore = create<FocusState>((set, get) => ({
	focusedEventId: null,
	focusedSessionId: null,
	focusedTaskId: null,
	focusedTaskDraftId: null,
	focusedArchivedSessionId: null,
	focusedArchivedTaskId: null,
	editingSessionId: null,
	focusSource: null,
	lastNavWasHotkey: false,
	lastHotkeyDebug: null,
	focusedArea: FOCUSED_AREAS.MAIN,
	isEditorFocused: false,
	focusedSidebarItem: null,

	setFocusedEventId: (id, source) => set({ focusedEventId: id, focusSource: source }),
	setFocusedSessionId: (id, source) => set({ focusedSessionId: id, focusSource: source }),
	setFocusedTaskId: (id, source) => set({ focusedTaskId: id, focusSource: source }),
	setFocusedTaskDraftId: (id, source) => set({ focusedTaskDraftId: id, focusSource: source }),
	setFocusedArchivedSessionId: (id, source) => set({ focusedArchivedSessionId: id, focusSource: source }),
	setFocusedArchivedTaskId: (id, source) => set({ focusedArchivedTaskId: id, focusSource: source }),
	setEditingSessionId: (id) => set({ editingSessionId: id }),
	setLastNavWasHotkey: (value) => set((s) => (s.lastNavWasHotkey === value ? s : { lastNavWasHotkey: value })),
	setLastHotkeyDebug: (event) => set({ lastHotkeyDebug: event }),
	enableMouseFocus: () => set({ focusSource: 'mouse' }),
	clearFocus: () =>
		set({
			focusedEventId: null,
			focusedSessionId: null,
			focusedTaskId: null,
			focusedTaskDraftId: null,
			focusedArchivedSessionId: null,
			focusedArchivedTaskId: null,
			focusSource: null,
		}),
	focusSidebar: () => set({ focusedArea: FOCUSED_AREAS.LEFT_NAV }),
	focusMain: () => set({ focusedArea: FOCUSED_AREAS.MAIN, focusedSidebarItem: null }),
	focusRightPane: () => set({ focusedArea: FOCUSED_AREAS.RIGHT_PANE, focusedSidebarItem: null }),
	moveFocusLeft: (_rightPaneAvailable) => {
		const area = get().focusedArea
		if (area === FOCUSED_AREAS.RIGHT_PANE) {
			set({ focusedArea: FOCUSED_AREAS.MAIN, focusedSidebarItem: null })
		} else if (area === FOCUSED_AREAS.MAIN) {
			set({ focusedArea: FOCUSED_AREAS.LEFT_NAV })
		}
	},
	moveFocusRight: (rightPaneAvailable) => {
		const area = get().focusedArea
		if (area === FOCUSED_AREAS.LEFT_NAV) {
			set({ focusedArea: FOCUSED_AREAS.MAIN, focusedSidebarItem: null })
		} else if (area === FOCUSED_AREAS.MAIN && rightPaneAvailable) {
			set({ focusedArea: FOCUSED_AREAS.RIGHT_PANE, focusedSidebarItem: null })
		}
	},
	setIsEditorFocused: (value) => set((s) => (s.isEditorFocused === value ? s : { isEditorFocused: value })),
	setFocusedSidebarItem: (item) => set({ focusedSidebarItem: item }),
	focusAfterSidebarTaskRemoved: (items, taskId) => {
		const current = get().focusedSidebarItem
		if (current?.type !== 'task' || current.id !== taskId) return

		const currentIndex = items.findIndex((item) => item.type === 'task' && item.id === taskId)
		if (currentIndex === -1) {
			set({ focusedSidebarItem: null })
			return
		}

		const isRemovedItem = (item: SidebarItem) =>
			(item.type === 'task' && item.id === taskId) || (item.type === 'session' && item.taskId === taskId)
		const nextItem = items.slice(currentIndex + 1).find((item) => !isRemovedItem(item))
		const previousItem = [...items.slice(0, currentIndex)].reverse().find((item) => !isRemovedItem(item))
		set({ focusedSidebarItem: nextItem ?? previousItem ?? null })
	},
	focusNextSidebarItem: (items) => {
		if (items.length === 0) return
		const current = get().focusedSidebarItem
		if (!current) {
			set({ focusedSidebarItem: items[0] })
			return
		}
		const idx = findItemIndex(items, current)
		const nextIdx = (idx + 1) % items.length
		set({ focusedSidebarItem: items[nextIdx] })
	},
	focusPrevSidebarItem: (items) => {
		if (items.length === 0) return
		const current = get().focusedSidebarItem
		if (!current) {
			set({ focusedSidebarItem: items[items.length - 1] })
			return
		}
		const idx = findItemIndex(items, current)
		const prevIdx = idx <= 0 ? items.length - 1 : idx - 1
		set({ focusedSidebarItem: items[prevIdx] })
	},
	focusFirstSidebarItem: (items) => {
		if (items.length > 0) set({ focusedSidebarItem: items[0] })
	},
	focusLastSidebarItem: (items) => {
		if (items.length > 0) set({ focusedSidebarItem: items[items.length - 1] })
	},
	focusNextDraft: (taskDrafts, sessionDrafts) => {
		const hasTaskDrafts = taskDrafts.length > 0
		const hasSessionDrafts = sessionDrafts.length > 0
		if (!hasTaskDrafts && !hasSessionDrafts) return

		const { focusedTaskDraftId, focusedSessionId } = get()

		if (focusedTaskDraftId) {
			const currentIndex = taskDrafts.findIndex((d) => d.id === focusedTaskDraftId)
			if (currentIndex < taskDrafts.length - 1) {
				const nextTaskDraft = taskDrafts[currentIndex + 1]
				if (nextTaskDraft === undefined) return
				set({ focusedTaskDraftId: nextTaskDraft.id, focusSource: 'keyboard' })
			} else if (hasSessionDrafts) {
				const firstSessionDraft = sessionDrafts[0]
				if (firstSessionDraft === undefined) return
				set({ focusedTaskDraftId: null, focusedSessionId: firstSessionDraft.id, focusSource: 'keyboard' })
			} else {
				const firstTaskDraft = taskDrafts[0]
				if (firstTaskDraft === undefined) return
				set({ focusedTaskDraftId: firstTaskDraft.id, focusSource: 'keyboard' })
			}
			return
		}

		if (focusedSessionId) {
			const currentIndex = sessionDrafts.findIndex((s) => s.id === focusedSessionId)
			if (currentIndex < sessionDrafts.length - 1) {
				const nextSessionDraft = sessionDrafts[currentIndex + 1]
				if (nextSessionDraft === undefined) return
				set({ focusedSessionId: nextSessionDraft.id, focusSource: 'keyboard' })
			} else if (hasTaskDrafts) {
				const firstTaskDraft = taskDrafts[0]
				if (firstTaskDraft === undefined) return
				set({ focusedSessionId: null, focusedTaskDraftId: firstTaskDraft.id, focusSource: 'keyboard' })
			} else {
				const firstSessionDraft = sessionDrafts[0]
				if (firstSessionDraft === undefined) return
				set({ focusedSessionId: firstSessionDraft.id, focusSource: 'keyboard' })
			}
			return
		}

		if (hasTaskDrafts) {
			const firstTaskDraft = taskDrafts[0]
			if (firstTaskDraft === undefined) return
			set({ focusedTaskDraftId: firstTaskDraft.id, focusSource: 'keyboard' })
		} else {
			const firstSessionDraft = sessionDrafts[0]
			if (firstSessionDraft === undefined) return
			set({ focusedSessionId: firstSessionDraft.id, focusSource: 'keyboard' })
		}
	},
	focusPrevDraft: (taskDrafts, sessionDrafts) => {
		const hasTaskDrafts = taskDrafts.length > 0
		const hasSessionDrafts = sessionDrafts.length > 0
		if (!hasTaskDrafts && !hasSessionDrafts) return

		const { focusedTaskDraftId, focusedSessionId } = get()

		if (focusedSessionId) {
			const currentIndex = sessionDrafts.findIndex((s) => s.id === focusedSessionId)
			if (currentIndex > 0) {
				const prevSessionDraft = sessionDrafts[currentIndex - 1]
				if (prevSessionDraft === undefined) return
				set({ focusedSessionId: prevSessionDraft.id, focusSource: 'keyboard' })
			} else if (hasTaskDrafts) {
				const lastTaskDraft = taskDrafts[taskDrafts.length - 1]
				if (lastTaskDraft === undefined) return
				set({
					focusedSessionId: null,
					focusedTaskDraftId: lastTaskDraft.id,
					focusSource: 'keyboard',
				})
			} else {
				const lastSessionDraft = sessionDrafts[sessionDrafts.length - 1]
				if (lastSessionDraft === undefined) return
				set({ focusedSessionId: lastSessionDraft.id, focusSource: 'keyboard' })
			}
			return
		}

		if (focusedTaskDraftId) {
			const currentIndex = taskDrafts.findIndex((d) => d.id === focusedTaskDraftId)
			if (currentIndex > 0) {
				const prevTaskDraft = taskDrafts[currentIndex - 1]
				if (prevTaskDraft === undefined) return
				set({ focusedTaskDraftId: prevTaskDraft.id, focusSource: 'keyboard' })
			} else if (hasSessionDrafts) {
				const lastSessionDraft = sessionDrafts[sessionDrafts.length - 1]
				if (lastSessionDraft === undefined) return
				set({
					focusedTaskDraftId: null,
					focusedSessionId: lastSessionDraft.id,
					focusSource: 'keyboard',
				})
			} else {
				const lastTaskDraft = taskDrafts[taskDrafts.length - 1]
				if (lastTaskDraft === undefined) return
				set({ focusedTaskDraftId: lastTaskDraft.id, focusSource: 'keyboard' })
			}
			return
		}

		if (hasSessionDrafts) {
			const lastSessionDraft = sessionDrafts[sessionDrafts.length - 1]
			if (lastSessionDraft === undefined) return
			set({ focusedSessionId: lastSessionDraft.id, focusSource: 'keyboard' })
		} else {
			const lastTaskDraft = taskDrafts[taskDrafts.length - 1]
			if (lastTaskDraft === undefined) return
			set({ focusedTaskDraftId: lastTaskDraft.id, focusSource: 'keyboard' })
		}
	},
}))
