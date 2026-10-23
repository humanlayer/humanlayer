import { create } from 'zustand'

type FocusSource = 'mouse' | 'keyboard' | null

interface FocusState {
	// Artifact table
	focusedArtifactId: string | null
	// Task table
	focusedTaskId: string | null
	// Source tracking for mouse protection
	focusSource: FocusSource
	// Whether the reader's last artifact-document keypress was a navigation key
	// (h/j/k/l). Drives the floating hotkey legend over the keyboard-focus cursor:
	// it shows after navigation and hides on any action key or mouse-driven focus.
	lastNavWasHotkey: boolean

	setFocusedArtifactId: (id: string | null, source: 'mouse' | 'keyboard') => void
	setFocusedTaskId: (id: string | null, source: 'mouse' | 'keyboard') => void
	// Set whether the last artifact-document keypress was a navigation key.
	setLastNavWasHotkey: (value: boolean) => void
	// Enable mouse focus without changing focus IDs - call on mouse move
	enableMouseFocus: () => void
	clearFocus: () => void
}

export const useFocusStore = create<FocusState>((set) => ({
	focusedArtifactId: null,
	focusedTaskId: null,
	focusSource: null,
	lastNavWasHotkey: false,

	setFocusedArtifactId: (id, source) => set({ focusedArtifactId: id, focusSource: source }),
	setFocusedTaskId: (id, source) => set({ focusedTaskId: id, focusSource: source }),
	setLastNavWasHotkey: (value) => set((s) => (s.lastNavWasHotkey === value ? s : { lastNavWasHotkey: value })),
	enableMouseFocus: () => set({ focusSource: 'mouse' }),
	clearFocus: () => set({ focusedArtifactId: null, focusedTaskId: null, focusSource: null }),
}))
