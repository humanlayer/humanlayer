import { describe, test, expect, beforeEach } from 'bun:test'
import { create } from 'zustand'
import { createAppSlice, AppSlice } from './appSlice'
import { createStoreTest, testInitialState, mockFactory } from '../test-utils'
import { Approval, ApprovalStatus } from '@/lib/daemon/types'

describe('Demo AppSlice', () => {
  let store: ReturnType<typeof createStoreTest<AppSlice>>

  beforeEach(() => {
    store = createStoreTest(() => create<AppSlice>()(createAppSlice))
  })

  describe('Initial State', () => {
    test('should initialize with correct defaults', () => {
      testInitialState(store.getState(), {
        connected: true,
        status: 'Connected! Daemon @ v1.0.0',
        approvals: [],
        currentRoute: '/',
      })
    })
  })

  describe('Connection Management', () => {
    test('should handle connection state changes', () => {
      store.testSetters([
        ['setConnected', 'connected', false],
        ['setConnected', 'connected', true],
        ['setStatus', 'status', 'Disconnected'],
        ['setStatus', 'status', 'Reconnecting...'],
      ])
    })

    test('should handle disconnect/reconnect workflow', () => {
      // Disconnect
      store.act(s => s.disconnect())
      expect(store.getState().connected).toBe(false)
      expect(store.getState().status).toBe('Disconnected from daemon')

      // Reconnect
      store.act(s => s.reconnect())
      expect(store.getState().connected).toBe(true)
      expect(store.getState().status).toBe('Reconnected! Daemon @ v1.0.0')
    })
  })

  describe('Approval Management', () => {
    const mockApprovals = mockFactory.approvals(3)

    test('should handle approval operations', () => {
      // Set approvals
      store.testSetter('setApprovals', 'approvals', mockApprovals)

      // Add single approval
      const newApproval: Approval = {
        id: '4',
        run_id: 'run-4',
        session_id: 'session-4',
        status: ApprovalStatus.Pending,
        created_at: new Date().toISOString(),
        tool_name: 'Edit',
        tool_input: {
          file_path: '/test/file.ts',
          old_string: 'old',
          new_string: 'new',
        },
      }
      store.act(s => s.addApproval(newApproval))
      expect(store.getState().approvals).toHaveLength(4)
      expect(store.getState().approvals.some(a => a.id === newApproval.id)).toBe(true)

      // Remove approval
      store.act(s => s.removeApproval('2'))
      expect(store.getState().approvals).toHaveLength(3)
      expect(store.getState().approvals.find(a => a.id === '2')).toBeUndefined()

      // Clear all
      store.act(s => s.clearApprovals())
      expect(store.getState().approvals).toEqual([])
    })

    test('should provide approval utilities', () => {
      store.act(s => s.setApprovals(mockApprovals))

      const state = store.getState()
      expect(state.getApprovalCount()).toBe(3)
      expect(state.hasApproval('2')).toBe(true)
      expect(state.hasApproval('99')).toBe(false)
    })
  })

  describe('Routing', () => {
    test('should handle routing operations', () => {
      // Set route
      store.testSetter('setCurrentRoute', 'currentRoute', '/sessions')

      // Navigate
      store.act(s => s.navigateTo('/sessions/123'))
      expect(store.getState().currentRoute).toBe('/sessions/123')

      // Check route
      expect(store.getState().isOnRoute('/sessions/123')).toBe(true)
      expect(store.getState().isOnRoute('/approvals')).toBe(false)

      // Get params
      const params = store.getState().getRouteParams()
      expect(params).toEqual(['sessions', '123'])
    })
  })

  describe('App State', () => {
    test('should reset app state', () => {
      // Modify state
      store.act(s => {
        s.setConnected(false)
        s.setStatus('Error')
        s.setApprovals([
          {
            id: '1',
            run_id: 'run-1',
            session_id: 'session-1',
            status: ApprovalStatus.Pending,
            created_at: new Date().toISOString(),
            tool_name: 'Bash',
            tool_input: { command: 'test', description: 'Test' },
          },
        ])
        s.setCurrentRoute('/sessions')
      })

      // Reset
      store.act(s => s.resetAppState())

      testInitialState(store.getState(), {
        connected: true,
        status: 'Connected! Daemon @ v1.0.0',
        approvals: [],
        currentRoute: '/',
      })
    })

    test('should check app readiness', () => {
      expect(store.getState().isReady()).toBe(true)

      store.act(s => s.setConnected(false))
      expect(store.getState().isReady()).toBe(false)

      store.act(s => s.setConnected(true))
      expect(store.getState().isReady()).toBe(true)
    })

    test('should get status info', () => {
      store.act(s => {
        s.setApprovals(mockFactory.approvals(2))
        s.setCurrentRoute('/approvals')
      })

      const info = store.getState().getStatusInfo()
      expect(info).toEqual({
        connected: true,
        status: 'Connected! Daemon @ v1.0.0',
        approvalCount: 2,
        currentRoute: '/approvals',
      })
    })
  })
})
