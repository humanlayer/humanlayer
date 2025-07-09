import { createContext, useContext, useEffect, useState } from 'react'
import { StoreApi, useStore } from 'zustand'
import { AppState, createRealAppStore } from './appStore'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { useSubscriptions } from '@/hooks/useSubscriptions'
import { toast } from 'sonner'

// Single context - components don't choose between real/demo
export const AppStoreContext = createContext<StoreApi<AppState> | null>(null)

// Hook that all components use
export function useAppStore<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext)
  if (!store) throw new Error('useAppStore must be used within AppStoreProvider')
  return useStore(store, selector)
}

// Real store provider that connects to daemon
export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(() => createRealAppStore())
  const { connected } = useDaemonConnection()

  // Initialize sessions when connection is established
  useEffect(() => {
    if (connected) {
      store.getState().refreshSessions()
    }
  }, [connected, store])

  // Set up subscriptions for real-time updates
  useSubscriptions({
    onSessionUpdate: (update) => {
      const { sessionId, changes } = update
      store.getState().updateSession(sessionId, changes)
    },
    onSessionsRefresh: (sessions) => {
      store.getState().initSessions(sessions)
    },
    onApprovalsUpdate: (approvals) => {
      store.getState().setApprovals(approvals)
    },
    onError: (error) => {
      toast.error(`Subscription error: ${error.message}`)
    },
  })

  return (
    <AppStoreContext.Provider value={store}>
      {children}
    </AppStoreContext.Provider>
  )
}
