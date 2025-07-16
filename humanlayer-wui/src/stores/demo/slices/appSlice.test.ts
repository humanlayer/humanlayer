import { describe, test, expect, beforeEach } from 'bun:test'
import { create, StoreApi } from 'zustand'
import { createAppSlice, AppSlice } from './appSlice'

// Helper to create a test store with just the app slice
function createTestStore(): StoreApi<AppSlice> {
  return create<AppSlice>()(createAppSlice)
}

describe('Demo AppSlice', () => {
  let store: StoreApi<AppSlice>

  beforeEach(() => {
    store = createTestStore()
  })

  describe('Initial State', () => {
    test('should initialize with correct defaults', () => {
      const state = store.getState()
      expect(state.connected).toBe(true)
      expect(state.status).toBe('Connected! Daemon @ v1.0.0')
      expect(state.approvals).toEqual([])
      expect(state.currentRoute).toBe('/')
    })
  })

  describe('Connection Management', () => {
    test('should set connected state', () => {
      store.getState().setConnected(false)
      expect(store.getState().connected).toBe(false)

      store.getState().setConnected(true)
      expect(store.getState().connected).toBe(true)
    })

    test('should set status message', () => {
      store.getState().setStatus('Disconnected')
      expect(store.getState().status).toBe('Disconnected')

      store.getState().setStatus('Reconnecting...')
      expect(store.getState().status).toBe('Reconnecting...')
    })

    test('should handle connection workflow', () => {
      // Simulate disconnect
      store.getState().disconnect()

      let state = store.getState()
      expect(state.connected).toBe(false)
      expect(state.status).toBe('Disconnected from daemon')

      // Simulate reconnect
      store.getState().reconnect()

      state = store.getState()
      expect(state.connected).toBe(true)
      expect(state.status).toBe('Reconnected! Daemon @ v1.0.0')
    })
  })

  describe('Approval Management', () => {
    const mockApprovals = [
      { id: '1', title: 'Approval 1', status: 'pending' },
      { id: '2', title: 'Approval 2', status: 'pending' },
      { id: '3', title: 'Approval 3', status: 'pending' },
    ]

    test('should set approvals', () => {
      store.getState().setApprovals(mockApprovals)
      expect(store.getState().approvals).toEqual(mockApprovals)
    })

    test('should add single approval', () => {
      const newApproval = { id: '4', title: 'New Approval', status: 'pending' }
      store.getState().addApproval(newApproval)

      expect(store.getState().approvals).toContain(newApproval)
      expect(store.getState().approvals.length).toBe(1)
    })

    test('should remove approval by id', () => {
      store.getState().setApprovals(mockApprovals)
      store.getState().removeApproval('2')

      const state = store.getState()
      expect(state.approvals.length).toBe(2)
      expect(state.approvals.find(a => a.id === '2')).toBeUndefined()
    })

    test('should clear all approvals', () => {
      store.getState().setApprovals(mockApprovals)
      store.getState().clearApprovals()

      expect(store.getState().approvals).toEqual([])
    })

    test('should get approval count', () => {
      expect(store.getState().getApprovalCount()).toBe(0)

      store.getState().setApprovals(mockApprovals)
      expect(store.getState().getApprovalCount()).toBe(3)
    })

    test('should check if approval exists', () => {
      store.getState().setApprovals(mockApprovals)

      expect(store.getState().hasApproval('2')).toBe(true)
      expect(store.getState().hasApproval('99')).toBe(false)
    })
  })

  describe('Routing', () => {
    test('should set current route', () => {
      store.getState().setCurrentRoute('/sessions')
      expect(store.getState().currentRoute).toBe('/sessions')

      store.getState().setCurrentRoute('/approvals')
      expect(store.getState().currentRoute).toBe('/approvals')
    })

    test('should navigate to route', () => {
      store.getState().navigateTo('/sessions/123')
      expect(store.getState().currentRoute).toBe('/sessions/123')
    })

    test('should check if on route', () => {
      store.getState().setCurrentRoute('/sessions')

      expect(store.getState().isOnRoute('/sessions')).toBe(true)
      expect(store.getState().isOnRoute('/approvals')).toBe(false)
    })

    test('should get route params', () => {
      store.getState().setCurrentRoute('/sessions/123/edit')

      const params = store.getState().getRouteParams()
      expect(params).toEqual(['sessions', '123', 'edit'])
    })
  })

  describe('App State', () => {
    test('should reset app state', () => {
      // Modify state
      store.getState().setConnected(false)
      store.getState().setStatus('Error')
      store.getState().setApprovals([{ id: '1', title: 'Test', status: 'pending' }])
      store.getState().setCurrentRoute('/sessions')

      // Reset
      store.getState().resetAppState()

      const state = store.getState()
      expect(state.connected).toBe(true)
      expect(state.status).toBe('Connected! Daemon @ v1.0.0')
      expect(state.approvals).toEqual([])
      expect(state.currentRoute).toBe('/')
    })

    test('should check if app is ready', () => {
      // Initially ready (connected)
      expect(store.getState().isReady()).toBe(true)

      // Not ready when disconnected
      store.getState().setConnected(false)
      expect(store.getState().isReady()).toBe(false)

      // Ready again when reconnected
      store.getState().setConnected(true)
      expect(store.getState().isReady()).toBe(true)
    })

    test('should get app status info', () => {
      const info = store.getState().getStatusInfo()

      expect(info).toEqual({
        connected: true,
        status: 'Connected! Daemon @ v1.0.0',
        approvalCount: 0,
        currentRoute: '/',
      })

      // Modify state and check again
      store.getState().setApprovals([
        { id: '1', title: 'Test 1', status: 'pending' },
        { id: '2', title: 'Test 2', status: 'pending' },
      ])
      store.getState().setCurrentRoute('/approvals')

      const updatedInfo = store.getState().getStatusInfo()
      expect(updatedInfo.approvalCount).toBe(2)
      expect(updatedInfo.currentRoute).toBe('/approvals')
    })
  })
})
