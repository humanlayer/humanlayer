import type { Content } from '@tiptap/core'
import { create } from 'zustand'

import { getTextFromContent } from '@/utils/tiptap-content'

interface ApprovalState {
	approvingApprovalId: string | null
	denyingApproval: { id: string; toolName: string } | null
	denyFeedbackText: string | null
	denyContent: Content | null
	setDenyContent: (content: Content | null) => void

	setApprovingApprovalId: (id: string | null) => void
	startDeny: (id: string, toolName: string) => void
	cancelDeny: () => void
	setDenyFeedbackText: (text: string | null) => void
}

export const useApprovalStore = create<ApprovalState>((set) => ({
	approvingApprovalId: null,
	denyingApproval: null,
	denyFeedbackText: null,
	denyContent: null,
	setDenyContent: (denyContent) =>
		set({ denyContent, denyFeedbackText: getTextFromContent(denyContent).trim() || null }),

	setApprovingApprovalId: (id) => set({ approvingApprovalId: id }),
	startDeny: (id, toolName) => set({ denyingApproval: { id, toolName }, denyContent: null, denyFeedbackText: null }),
	cancelDeny: () => set({ denyingApproval: null, denyFeedbackText: null, denyContent: null }),
	setDenyFeedbackText: (text) => set({ denyFeedbackText: text }),
}))
