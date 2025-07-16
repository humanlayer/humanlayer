import { StateCreator } from 'zustand'

export interface AppSlice {
  // Connection state
  connected: boolean
  status: string
  
  // Approvals (simplified for demo)
  approvals: any[]
  
  // Routing
  currentRoute: string
  
  // Actions
  setConnected: (connected: boolean) => void
  setStatus: (status: string) => void
  setApprovals: (approvals: any[]) => void
  setCurrentRoute: (route: string) => void
  
  // Approval actions
  addApproval: (approval: any) => void
  removeApproval: (id: string) => void
  clearApprovals: () => void
  getApprovalCount: () => number
  hasApproval: (id: string) => boolean
  
  // Connection workflow
  disconnect: () => void
  reconnect: () => void
  
  // Routing actions
  navigateTo: (route: string) => void
  isOnRoute: (route: string) => boolean
  getRouteParams: () => string[]
  
  // App state management
  resetAppState: () => void
  isReady: () => boolean
  getStatusInfo: () => {
    connected: boolean
    status: string
    approvalCount: number
    currentRoute: string
  }
}

export const createAppSlice: StateCreator<
  AppSlice,
  [],
  [],
  AppSlice
> = (set, get) => ({
  // Initial state
  connected: true,
  status: 'Connected! Daemon @ v1.0.0',
  approvals: [],
  currentRoute: '/',
  
  // Basic setters
  setConnected: (connected) => set({ connected }),
  setStatus: (status) => set({ status }),
  setApprovals: (approvals) => set({ approvals }),
  setCurrentRoute: (route) => set({ currentRoute: route }),
  
  // Approval actions
  addApproval: (approval) => set((state) => ({
    approvals: [...state.approvals, approval]
  })),
  
  removeApproval: (id) => set((state) => ({
    approvals: state.approvals.filter(a => a.id !== id)
  })),
  
  clearApprovals: () => set({ approvals: [] }),
  
  getApprovalCount: () => {
    return get().approvals.length
  },
  
  hasApproval: (id) => {
    return get().approvals.some(a => a.id === id)
  },
  
  // Connection workflow
  disconnect: () => {
    set({
      connected: false,
      status: 'Disconnected from daemon'
    })
  },
  
  reconnect: () => {
    set({
      connected: true,
      status: 'Reconnected! Daemon @ v1.0.0'
    })
  },
  
  // Routing actions
  navigateTo: (route) => {
    set({ currentRoute: route })
  },
  
  isOnRoute: (route) => {
    return get().currentRoute === route
  },
  
  getRouteParams: () => {
    const route = get().currentRoute
    return route.split('/').filter(p => p.length > 0)
  },
  
  // App state management
  resetAppState: () => {
    set({
      connected: true,
      status: 'Connected! Daemon @ v1.0.0',
      approvals: [],
      currentRoute: '/'
    })
  },
  
  isReady: () => {
    return get().connected
  },
  
  getStatusInfo: () => {
    const state = get()
    return {
      connected: state.connected,
      status: state.status,
      approvalCount: state.approvals.length,
      currentRoute: state.currentRoute
    }
  }
})