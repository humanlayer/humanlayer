import { create } from 'zustand'

interface SessionOnboardingState {
	phaseTipSuppressedForMount: boolean
	suppressPhaseTipForMount: () => void
	reset: () => void
}

export const useSessionOnboardingStore = create<SessionOnboardingState>((set) => ({
	phaseTipSuppressedForMount: false,
	suppressPhaseTipForMount: () => set({ phaseTipSuppressedForMount: true }),
	reset: () => set({ phaseTipSuppressedForMount: false }),
}))
