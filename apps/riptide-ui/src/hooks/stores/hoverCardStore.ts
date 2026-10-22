import type { GutterItemInfo } from '@humanlayer/ui/markdown-viewer/CommentGutterOverlay'
import { create } from 'zustand'

let hoverTimeoutRef: ReturnType<typeof setTimeout> | null = null

interface HoverCardState {
	activeGutterInfo: GutterItemInfo | null
	showHoverCard: (info: GutterItemInfo) => void
	scheduleHide: () => void
	keepAlive: () => void
	hideNow: () => void
}

export const useHoverCardStore = create<HoverCardState>((set) => ({
	activeGutterInfo: null,
	showHoverCard: (info) => {
		if (hoverTimeoutRef) clearTimeout(hoverTimeoutRef)
		hoverTimeoutRef = setTimeout(() => set({ activeGutterInfo: info }), 200)
	},
	scheduleHide: () => {
		if (hoverTimeoutRef) clearTimeout(hoverTimeoutRef)
		hoverTimeoutRef = setTimeout(() => set({ activeGutterInfo: null }), 400)
	},
	keepAlive: () => {
		if (hoverTimeoutRef) clearTimeout(hoverTimeoutRef)
	},
	hideNow: () => {
		if (hoverTimeoutRef) clearTimeout(hoverTimeoutRef)
		set({ activeGutterInfo: null })
	},
}))
