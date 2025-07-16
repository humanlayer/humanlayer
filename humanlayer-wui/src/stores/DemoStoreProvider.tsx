import { useEffect, useState } from 'react'
import { createDemoAppStore } from './appStore'
import { AppStoreContext } from './AppStoreProvider'
import { DemoAnimator, AnimationStep } from './DemoAnimator'

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
