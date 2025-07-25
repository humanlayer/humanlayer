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
    onSessionStatusChanged: async (data, timestamp) => {
      // Handle session status changes
      const { session_id, new_status } = data
      const state = store.getState()
      
      // Update session in the list
      state.updateSessionStatus(session_id, new_status as SessionStatus)
      
      // If this is the active session detail, refresh its data
      if (state.activeSessionDetail?.session.id === session_id) {
        try {
          // Fetch fresh conversation data when status changes
          const messagesResponse = await daemonClient.getSessionMessages(session_id)
          state.updateActiveSessionConversation(messagesResponse)
        } catch (error) {
          console.error('Failed to refresh active session conversation:', error)
        }
      }
    },
    onNewApproval: async data => {
      const state = store.getState()
      
      // Handle new approvals
      console.log('New approval event:', data)
      
      // Add the approval to the store
      if (data.approval_id && data.session_id) {
        // For now, create a minimal approval object
        // TODO: Fetch full approval data from daemon
        const approval = {
          id: data.approval_id,
          session_id: data.session_id,
          tool_name: data.tool_name || 'Unknown Tool',
          status: 'pending' as const,
          created_at: new Date().toISOString(),
        }
        state.addApproval(approval as any)
      }
      
      // If this approval is for the active session detail, refresh conversation
      if (state.activeSessionDetail?.session.id === data.session_id) {
        try {
          const messagesResponse = await daemonClient.getSessionMessages(data.session_id)
          state.updateActiveSessionConversation(messagesResponse)
        } catch (error) {
          console.error('Failed to refresh active session conversation:', error)
        }
      }
    },
    onApprovalResolved: async data => {
      const state = store.getState()
      
      // Handle resolved approvals
      const { approval_id, decision } = data
      const approvals = state.approvals.filter(a => {
        return a.id !== approval_id
      })
      state.setApprovals(approvals)
      toast.success(`Approval ${decision === 'approve' ? 'approved' : 'rejected'}`)
      
      // If this approval was in the active session, refresh conversation
      const resolvedApproval = state.approvals.find(a => a.id === approval_id)
      if (resolvedApproval && state.activeSessionDetail?.session.id === resolvedApproval.session_id) {
        try {
          const messagesResponse = await daemonClient.getSessionMessages(resolvedApproval.session_id)
          state.updateActiveSessionConversation(messagesResponse)
        } catch (error) {
          console.error('Failed to refresh active session conversation:', error)
        }
      }
    },
  })

  return <AppStoreContext.Provider value={store}>{children}</AppStoreContext.Provider>
}
