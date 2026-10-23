import { create } from 'zustand'

interface HotkeyHelpState {
	isOpen: boolean
	setOpen: (open: boolean) => void
	open: () => void
	close: () => void
	toggle: () => void
}

export const useHotkeyHelpStore = create<HotkeyHelpState>((set) => ({
	isOpen: false,
	setOpen: (isOpen) => set({ isOpen }),
	open: () => set({ isOpen: true }),
	close: () => set({ isOpen: false }),
	toggle: () => set((state) => ({ isOpen: !state.isOpen })),
}))
