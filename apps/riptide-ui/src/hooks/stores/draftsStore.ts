import type { Content } from '@tiptap/core'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const DRAFTS_STORAGE_KEY = 'riptide-session-drafts'

interface DraftsState {
	drafts: Record<string, Content | null>
	setDraft: (sessionId: string, content: Content | null) => void
	clearDraft: (sessionId: string) => void
	restoreDraft: (sessionId: string, content: Content) => void
}

export const useDraftsStore = create<DraftsState>()(
	persist(
		(set) => ({
			drafts: {},
			setDraft: (sessionId, content) => set((s) => ({ drafts: { ...s.drafts, [sessionId]: content } })),
			clearDraft: (sessionId) =>
				set((s) => {
					const { [sessionId]: _, ...rest } = s.drafts
					return { drafts: rest }
				}),
			restoreDraft: (sessionId, content) => set((s) => ({ drafts: { ...s.drafts, [sessionId]: content } })),
		}),
		{
			name: DRAFTS_STORAGE_KEY,
			partialize: (state) => ({ drafts: state.drafts }),
		},
	),
)
