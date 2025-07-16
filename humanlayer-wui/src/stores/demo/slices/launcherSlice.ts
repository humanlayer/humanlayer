import { StateCreator } from 'zustand'

export interface LauncherSlice {
  // State
  isOpen: boolean
  mode: 'command' | 'search'
  view: 'menu' | 'input'
  query: string
  isLaunching: boolean
  error?: string
  selectedMenuIndex: number

  // Actions
  setOpen: (open: boolean) => void
  setMode: (mode: 'command' | 'search') => void
  setView: (view: 'menu' | 'input') => void
  setQuery: (query: string) => void
  setIsLaunching: (loading: boolean) => void
  setError: (error?: string) => void
  setSelectedMenuIndex: (index: number) => void

  // Workflow actions
  openLauncher: (mode?: 'command' | 'search') => void
  closeLauncher: () => void
  resetLauncher: () => void

  // Menu navigation
  navigateMenu: (direction: 'up' | 'down', totalItems: number) => void

  // State checks
  isReady: () => boolean
  hasError: () => boolean
}

export const createLauncherSlice: StateCreator<LauncherSlice, [], [], LauncherSlice> = (set, get) => ({
  // Initial state
  isOpen: false,
  mode: 'command',
  view: 'menu',
  query: '',
  isLaunching: false,
  error: undefined,
  selectedMenuIndex: 0,

  // Basic setters
  setOpen: open => set({ isOpen: open }),
  setMode: mode => set({ mode }),
  setView: view => set({ view }),
  setQuery: query => set({ query, error: undefined }), // Clear error when typing
  setIsLaunching: loading => set({ isLaunching: loading }),
  setError: error => set({ error }),
  setSelectedMenuIndex: index => set({ selectedMenuIndex: index }),

  // Workflow actions
  openLauncher: (mode = 'command') =>
    set({
      isOpen: true,
      mode,
      view: 'menu',
      error: undefined,
      selectedMenuIndex: 0,
    }),

  closeLauncher: () =>
    set({
      isOpen: false,
      view: 'menu',
      query: '',
      error: undefined,
      isLaunching: false,
      selectedMenuIndex: 0,
    }),

  resetLauncher: () =>
    set({
      isOpen: false,
      mode: 'command',
      view: 'menu',
      query: '',
      isLaunching: false,
      error: undefined,
      selectedMenuIndex: 0,
    }),

  // Menu navigation
  navigateMenu: (direction, totalItems) => {
    if (totalItems === 0) return

    const state = get()
    const currentIndex = state.selectedMenuIndex

    let newIndex: number
    if (direction === 'down') {
      newIndex = currentIndex === totalItems - 1 ? 0 : currentIndex + 1
    } else {
      newIndex = currentIndex === 0 ? totalItems - 1 : currentIndex - 1
    }

    set({ selectedMenuIndex: newIndex })
  },

  // State checks
  isReady: () => {
    const state = get()
    return (
      state.isOpen &&
      state.view === 'input' &&
      state.query.trim().length > 0 &&
      !state.isLaunching &&
      !state.error
    )
  },

  hasError: () => {
    const state = get()
    return !!state.error
  },
})
