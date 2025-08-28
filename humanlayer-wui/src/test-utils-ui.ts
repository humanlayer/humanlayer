import type { Session } from '@/lib/daemon/types'
import { ViewMode } from '@/lib/daemon/types'
import { useStore } from '@/AppStore'
import { expect } from 'bun:test'

/**
 * Enhanced test utilities for UI state management
 */

export interface UITestState {
  // Modal states
  isHotkeyPanelOpen: boolean

  // Session editing states
  editingSessionId: string | null
  editValue: string

  // Session states for context
  sessions: Session[]
  focusedSession: Session | null
  viewMode: ViewMode
  selectedSessions: Set<string>
}

/**
 * Create a mock UI state for testing
 */
export function createMockUIState(overrides: Partial<UITestState> = {}): UITestState {
  return {
    isHotkeyPanelOpen: false,
    editingSessionId: null,
    editValue: '',
    sessions: [],
    focusedSession: null,
    viewMode: ViewMode.Normal,
    selectedSessions: new Set(),
    ...overrides,
  }
}

/**
 * Set up store with UI test state
 */
export function setupStoreWithUIState(uiState: Partial<UITestState> = {}) {
  const mockState = createMockUIState(uiState)

  useStore.setState({
    // Session data
    sessions: mockState.sessions,
    focusedSession: mockState.focusedSession,
    viewMode: mockState.viewMode,
    selectedSessions: mockState.selectedSessions,

    // UI states
    isHotkeyPanelOpen: mockState.isHotkeyPanelOpen,
    editingSessionId: mockState.editingSessionId,
    editValue: mockState.editValue,

    // Reset other states
    pendingUpdates: new Map(),
    isRefreshing: false,
    activeSessionDetail: null,
    notifiedItems: new Set(),
    recentResolvedApprovalsCache: new Set(),
    recentNavigations: new Map(),
  })

  return mockState
}

/**
 * Test utilities for UI state assertions
 */
export const uiStateAssertions = {
  /**
   * Assert that modals are in expected states
   */
  expectModalStates(expected: { hotkeyPanel?: boolean }) {
    const state = useStore.getState()

    if (expected.hotkeyPanel !== undefined) {
      expect(state.isHotkeyPanelOpen).toBe(expected.hotkeyPanel)
    }
  },

  /**
   * Assert editing state
   */
  expectEditingState(expected: { sessionId?: string | null; value?: string }) {
    const state = useStore.getState()

    if (expected.sessionId !== undefined) {
      expect(state.editingSessionId).toBe(expected.sessionId)
    }

    if (expected.value !== undefined) {
      expect(state.editValue).toBe(expected.value)
    }
  },

  /**
   * Assert UI state basics
   */
  expectUIStateClean() {
    const state = useStore.getState()
    expect(state.isHotkeyPanelOpen).toBe(false)
    expect(state.editingSessionId).toBe(null)
    expect(state.editValue).toBe('')
  },

  /**
   * Assert selection state
   */
  expectSelectionState(expected: {
    selectedCount?: number
    selectedIds?: string[]
    focusedSessionId?: string | null
  }) {
    const state = useStore.getState()

    if (expected.selectedCount !== undefined) {
      expect(state.selectedSessions.size).toBe(expected.selectedCount)
    }

    if (expected.selectedIds !== undefined) {
      expected.selectedIds.forEach(id => {
        expect(state.selectedSessions.has(id)).toBe(true)
      })
    }

    if (expected.focusedSessionId !== undefined) {
      expect(state.focusedSession?.id || null).toBe(expected.focusedSessionId)
    }
  },

  /**
   * Assert view mode state
   */
  expectViewMode(expected: ViewMode) {
    const state = useStore.getState()
    expect(state.viewMode).toBe(expected)
  },
}

/**
 * Test workflow helpers
 */
export const uiTestScenarios = {
  /**
   * All modals closed, no editing
   */
  clean: (): Partial<UITestState> => ({
    isHotkeyPanelOpen: false,
    editingSessionId: null,
    editValue: '',
  }),

  /**
   * Hotkey panel open
   */
  hotkeyPanelOpen: (): Partial<UITestState> => ({
    isHotkeyPanelOpen: true,
    editingSessionId: null,
    editValue: '',
  }),

  /**
   * Complex scenario with sessions and selections
   */
  withSessionsAndSelections: (
    sessions: Session[],
    selectedIds: string[] = [],
    focusedSession: Session | null = null,
  ): Partial<UITestState> => ({
    sessions,
    selectedSessions: new Set(selectedIds),
    focusedSession,
  }),
}
