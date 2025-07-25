import React, { createContext, useEffect, useState } from 'react'
import { StoreApi } from 'zustand'
import { createDemoAppStore, AppState } from './appStore'
import { DemoAnimator, AnimationStep } from './DemoAnimator'

// Create the context locally since AppStoreProvider was unused
export const AppStoreContext = createContext<StoreApi<AppState> | null>(null)

interface DemoStoreProviderProps {
  children: React.ReactNode
  sequence: AnimationStep[]
  autoStart?: boolean
}

export function DemoStoreProvider({ children, sequence, autoStart = true }: DemoStoreProviderProps) {
  const [store] = useState(() => createDemoAppStore())
  const [animator] = useState(() => new DemoAnimator(store, sequence))

  useEffect(() => {
    if (autoStart) {
      animator.start()
    }

    return () => {
      animator.stop()
      // Reset store state
      store.setState({
        sessions: [],
        focusedSession: null,
        activeSessionId: null,
        approvals: [],
        isLoading: false,
        notifiedItems: new Set<string>(),
      })
    }
  }, [animator, store, autoStart])

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}
