import React, { createContext, useContext, useEffect, useState } from 'react'
import { StoreApi, useStore } from 'zustand'
import { AppState, createRealAppStore } from './appStore'
import { useDaemonConnection } from '@/hooks/useDaemonConnection'
import { useSessionSubscriptions } from '@/hooks/useSubscriptions'
import { toast } from 'sonner'
import { SessionStatus } from '@/lib/daemon/types'

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
  useSessionSubscriptions(connected, {
    onSessionStatusChanged: data => {
      // Handle session status changes
      const { session_id, new_status } = data
      store.getState().updateSession(session_id, { status: new_status as SessionStatus })
    },
    onNewApproval: data => {
      // Handle new approvals - for now just log since we need to fetch full approval data
      console.log('New approval event:', data)
      // TODO: Fetch full approval data from daemon using data.approval_id
    },
    onApprovalResolved: data => {
      // Handle resolved approvals
      const { approval_id, decision } = data
      const approvals = store.getState().approvals.filter(a => {
        return a.id !== approval_id
      })
      store.getState().setApprovals(approvals)
      toast.success(`Approval ${decision === 'approve' ? 'approved' : 'rejected'}`)
    },
  })

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}
