import { create } from 'zustand'

import type { CodingAgentSetupTarget } from '@/lib/coding-agent-setup'

interface CodingAgentSetupState {
	isOpen: boolean
	target: CodingAgentSetupTarget | null
	onContinue?: () => void
	onCancel?: () => void
	open: (opts: { target: CodingAgentSetupTarget; onContinue?: () => void; onCancel?: () => void }) => void
	close: () => void
}

export const useCodingAgentSetupStore = create<CodingAgentSetupState>()((set) => ({
	isOpen: false,
	target: null,
	onContinue: undefined,
	onCancel: undefined,
	open: (opts) =>
		set({
			isOpen: true,
			target: opts.target,
			onContinue: opts.onContinue,
			onCancel: opts.onCancel,
		}),
	close: () => set({ isOpen: false, target: null, onContinue: undefined, onCancel: undefined }),
}))
