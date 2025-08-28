/**
 * Comprehensive Integration Tests for Complete User Workflows
 *
 * Tests end-to-end user journeys across the entire HumanLayer WUI including:
 * - Session creation → editing → approval → archiving workflows
 * - Cross-component state synchronization
 * - Error recovery and resilience
 * - Real-time updates and optimistic UI
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { useStore } from '@/AppStore'
import { createMockSessions, createMockApprovals } from '@/test-utils'
import { Session, SessionStatus, Approval } from '@/lib/daemon/types'

// Mock external dependencies
const mockDaemonClient = {
  getSessions: mock(() => Promise.resolve([])),
  getSession: mock(() => Promise.resolve(null)),
  updateSession: mock(() => Promise.resolve()),
  archiveSession: mock(() => Promise.resolve()),
  continueSession: mock(() => Promise.resolve()),
  approveApproval: mock(() => Promise.resolve()),
  denyApproval: mock(() => Promise.resolve()),
  getApprovals: mock(() => Promise.resolve([])),
  launchSession: mock(() => Promise.resolve({ id: 'new-session-123' })),
}

mock.module('@/lib/daemon/client', () => ({
  daemonClient: mockDaemonClient,
}))

const mockLogger = {
  info: mock(),
  error: mock(),
  warn: mock(),
  debug: mock(),
}

mock.module('@/lib/logging', () => ({
  logger: mockLogger,
}))

describe('Complete User Workflows - Integration Tests', () => {
  beforeEach(() => {
    // Reset store state
    useStore.setState({
      sessions: [],
      approvals: [],
      focusedSessionIndex: null,
      selectedSessions: [],
      editingSessionId: null,
      expandedToolResult: null,
      isEditingTitle: null,
      sessionResponses: {},
      approvalDenials: {},
    })

    // Clear all mocks
    mockDaemonClient.getSessions.mockClear()
    mockDaemonClient.updateSession.mockClear()
    mockDaemonClient.archiveSession.mockClear()
    mockDaemonClient.approveApproval.mockClear()
    mockDaemonClient.denyApproval.mockClear()
    mockDaemonClient.launchSession.mockClear()
  })

  describe('Complete Session Lifecycle Workflow', () => {
    test('should handle full session creation → editing → approval → completion workflow', async () => {
      const store = useStore.getState()

      // Phase 1: Session Creation
      const launchRequest = {
        cwd: '/test/dir',
        title: 'Test Session',
        model: 'claude-3-sonnet',
        prompt: 'Implement a feature',
      }

      mockDaemonClient.launchSession.mockResolvedValueOnce({
        id: 'session-123',
      })

      const newSessionId = await store.launchSession(launchRequest)
      expect(newSessionId).toBe('session-123')
      expect(mockDaemonClient.launchSession).toHaveBeenCalledWith(launchRequest)

      // Phase 2: Session appears in list with initial state
      const mockSession: Session = {
        id: 'session-123',
        title: 'Test Session',
        status: SessionStatus.Running,
        cwd: '/test/dir',
        model: 'claude-3-sonnet',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      store.initSessions([mockSession])
      expect(store.sessions).toHaveLength(1)
      expect(store.sessions[0].id).toBe('session-123')

      // Phase 3: User edits session title
      store.startEdit('session-123', 'Test Session')
      expect(store.editingSessionId).toBe('session-123')
      expect(store.editValue).toBe('Test Session')

      // User types new title
      store.updateEditValue('Updated Feature Implementation')
      expect(store.editValue).toBe('Updated Feature Implementation')

      // Save edit with optimistic update
      mockDaemonClient.updateSession.mockResolvedValueOnce(undefined)
      await store.saveEdit()

      expect(mockDaemonClient.updateSession).toHaveBeenCalledWith('session-123', {
        title: 'Updated Feature Implementation',
      })

      // Optimistic update should have occurred
      expect(store.sessions[0].title).toBe('Updated Feature Implementation')
      expect(store.editingSessionId).toBeNull()

      // Phase 4: Session completion and archiving
      store.updateSession('session-123', { status: SessionStatus.Completed })
      expect(store.sessions[0].status).toBe(SessionStatus.Completed)

      // User archives completed session
      mockDaemonClient.archiveSession.mockResolvedValueOnce(undefined)
      await store.archiveSession('session-123', true)

      expect(mockDaemonClient.archiveSession).toHaveBeenCalledWith('session-123')
      expect(store.sessions[0].status).toBe(SessionStatus.Archived)
    })

    test('should handle session fork workflow', async () => {
      const store = useStore.getState()

      // Start with a completed session
      const parentSession: Session = {
        id: 'parent-123',
        title: 'Original Session',
        status: SessionStatus.Completed,
        cwd: '/test/dir',
        model: 'claude-3-sonnet',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      store.initSessions([parentSession])
      store.setFocusedSession(parentSession)

      // Set session response for forking
      store.setSessionResponse('parent-123', 'Continue with additional changes', true)
      expect(store.sessionResponses['parent-123']?.message).toBe('Continue with additional changes')
      expect(store.sessionResponses['parent-123']?.forkMode).toBe(true)

      // Execute fork
      mockDaemonClient.continueSession.mockResolvedValueOnce({
        id: 'fork-456',
      })

      const forkId = await store.continueSession('parent-123')
      expect(forkId).toBe('fork-456')
      expect(mockDaemonClient.continueSession).toHaveBeenCalledWith(
        'parent-123',
        'Continue with additional changes',
      )

      // Verify fork is created
      const forkSession: Session = {
        id: 'fork-456',
        title: 'Original Session (Fork)',
        status: SessionStatus.Running,
        cwd: '/test/dir',
        model: 'claude-3-sonnet',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      store.initSessions([parentSession, forkSession])
      expect(store.sessions).toHaveLength(2)
      expect(store.sessions.some(s => s.id === 'fork-456')).toBe(true)
    })
  })

  describe('Cross-Component State Synchronization', () => {
    test('should synchronize editing state across SessionTable and SessionDetail', async () => {
      const store = useStore.getState()
      const mockSession: Session = {
        id: 'session-789',
        title: 'Sync Test Session',
        status: SessionStatus.Running,
        cwd: '/test/dir',
        model: 'claude-3-sonnet',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      store.initSessions([mockSession])

      // Start editing from SessionTable component simulation
      store.startEdit('session-789', 'Sync Test Session')
      expect(store.editingSessionId).toBe('session-789')

      // Verify SessionDetail can also check editing state
      expect(store.isEditing('session-789')).toBe(true)
      expect(store.getEditValue()).toBe('Sync Test Session')

      // Update edit value (could be from either component)
      store.updateEditValue('Synchronized Title')
      expect(store.editValue).toBe('Synchronized Title')

      // Cancel edit should clear state everywhere
      store.cancelEdit()
      expect(store.editingSessionId).toBeNull()
      expect(store.editValue).toBe('')
      expect(store.isEditing('session-789')).toBe(false)
    })

    test('should synchronize UI modal states across components', async () => {
      const store = useStore.getState()

      // Test modal state synchronization
      store.setExpandedToolResult('result-123')
      expect(store.expandedToolResult).toBe('result-123')

      store.setForkViewOpen(true)
      expect(store.forkViewOpen).toBe(true)

      // Test dangerous skip permissions dialog
      store.setDangerousSkipPermissionsDialogOpen(true)
      expect(store.dangerousSkipPermissionsDialogOpen).toBe(true)

      // Clear all modal states
      store.setExpandedToolResult(null)
      store.setForkViewOpen(false)
      store.setDangerousSkipPermissionsDialogOpen(false)

      expect(store.expandedToolResult).toBeNull()
      expect(store.forkViewOpen).toBe(false)
      expect(store.dangerousSkipPermissionsDialogOpen).toBe(false)
    })
  })

  describe('Error Recovery Scenarios', () => {
    test('should handle API failures during session operations', async () => {
      const store = useStore.getState()
      const mockSession: Session = {
        id: 'error-test',
        title: 'Error Test Session',
        status: SessionStatus.Running,
        cwd: '/test/dir',
        model: 'claude-3-sonnet',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }

      store.initSessions([mockSession])
      store.startEdit('error-test', 'Error Test Session')
      store.updateEditValue('Should Fail')

      // Simulate API failure
      mockDaemonClient.updateSession.mockRejectedValueOnce(new Error('Network error'))

      try {
        await store.saveEdit()
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect(error.message).toBe('Network error')
        // Verify state is preserved for retry
        expect(store.editingSessionId).toBe('error-test')
        expect(store.editValue).toBe('Should Fail')
        expect(store.sessions[0].title).toBe('Error Test Session') // No optimistic update on failure
      }
    })

    test('should handle approval workflow errors', async () => {
      const store = useStore.getState()
      const mockApproval: Approval = {
        id: 'error-approval',
        session_id: 'session-123',
        function_name: 'dangerous_operation',
        function_description: 'Potentially dangerous operation',
        parameters: { action: 'delete_all' },
        created_at: new Date().toISOString(),
      }

      store.setApprovals([mockApproval])

      // Set denial reason
      store.setApprovalDenialReason('error-approval', 'Too dangerous to approve')
      expect(store.approvalDenials['error-approval']?.reason).toBe('Too dangerous to approve')

      // Simulate denial API failure
      mockDaemonClient.denyApproval.mockRejectedValueOnce(new Error('Denial failed'))

      try {
        await store.denyApproval('error-approval', 'Too dangerous to approve')
        expect(false).toBe(true) // Should not reach here
      } catch (error) {
        expect(error.message).toBe('Denial failed')
        // Verify approval is still in list and denial reason preserved
        expect(store.approvals).toHaveLength(1)
        expect(store.approvals[0].id).toBe('error-approval')
        expect(store.approvalDenials['error-approval']?.reason).toBe('Too dangerous to approve')
      }
    })
  })

  describe('Bulk Operations Workflow', () => {
    test('should handle bulk session archiving with mixed results', async () => {
      const store = useStore.getState()
      const mockSessions = createMockSessions(5)

      // Mix of completed and running sessions
      mockSessions[0].status = SessionStatus.Completed
      mockSessions[1].status = SessionStatus.Completed
      mockSessions[2].status = SessionStatus.Running
      mockSessions[3].status = SessionStatus.Completed
      mockSessions[4].status = SessionStatus.Error

      store.initSessions(mockSessions)

      // Select multiple sessions
      store.clearSelection()
      store.toggleSessionSelection(mockSessions[0].id)
      store.toggleSessionSelection(mockSessions[1].id) 
      store.toggleSessionSelection(mockSessions[3].id)
      expect(store.selectedSessions.size).toBe(3)

      // Mock partial success scenario
      mockDaemonClient.archiveSession
        .mockResolvedValueOnce(undefined) // session 0 success
        .mockRejectedValueOnce(new Error('Archive failed')) // session 1 failure
        .mockResolvedValueOnce(undefined) // session 3 success

      // Execute bulk archive
      const results = await Promise.allSettled([
        store.archiveSession(mockSessions[0].id, true),
        store.archiveSession(mockSessions[1].id, true),
        store.archiveSession(mockSessions[3].id, true),
      ])

      // Verify mixed results
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('rejected')
      expect(results[2].status).toBe('fulfilled')

      // Verify state updates for successful operations
      expect(store.sessions[0].status).toBe(SessionStatus.Archived)
      expect(store.sessions[1].status).toBe(SessionStatus.Completed) // Unchanged due to error
      expect(store.sessions[3].status).toBe(SessionStatus.Archived)
    })
  })
})
