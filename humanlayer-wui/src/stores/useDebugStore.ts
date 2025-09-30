import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface DebugState {
  showDevUrl: boolean
  setShowDevUrl: (show: boolean) => void
  showHotkeyDebugger: boolean
  setShowHotkeyDebugger: (show: boolean) => void
}

export const useDebugStore = create<DebugState>()(
  devtools(
    persist(
      set => ({
        showDevUrl: true,
        setShowDevUrl: show => set({ showDevUrl: show }),
        showHotkeyDebugger: false,
        setShowHotkeyDebugger: show => set({ showHotkeyDebugger: show }),
      }),
      {
        name: 'debug-storage',
      },
    ),
    {
      name: 'debug-store',
    },
  ),
)
