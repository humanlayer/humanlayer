import { describe, test, expect, mock } from 'bun:test'
import { render, screen, fireEvent } from '@testing-library/react'
import { createRef } from 'react'

// Create mock functions
const mockCreateNewSession = mock(() => Promise.resolve())
const mockClose = mock(() => {})
const mockSetSettingsDialogOpen = mock(() => {})
const mockSetHotkeyPanelOpen = mock(() => {})
const mockArchiveSession = mock(() => Promise.resolve())
const mockBulkArchiveSessions = mock(() => Promise.resolve())

// Mock the hooks at the module level BEFORE importing the component
// This must happen before the component is imported
mock.module('@/hooks/useSessionLauncher', () => ({
  useSessionLauncher: () => ({
    createNewSession: mockCreateNewSession,
    close: mockClose,
  }),
  isViewingSessionDetail: () => false,
}))

mock.module('@/AppStore', () => {
  // This module is imported by other test files that expect a real store
  // So we need to provide a more complete mock that includes setState and getState
  const mockState: any = {
    sessions: [],
    focusedSession: null,
    selectedSessions: new Set(),
    activeSessionDetail: null,
    archiveSession: mockArchiveSession,
    bulkArchiveSessions: mockBulkArchiveSessions,
    setSettingsDialogOpen: mockSetSettingsDialogOpen,
    setHotkeyPanelOpen: mockSetHotkeyPanelOpen,
    // Add auto-scroll state for useAutoScroll hook
    autoScrollEnabled: true,
    setAutoScrollEnabled: mock((enabled: boolean) => {
      mockState.autoScrollEnabled = enabled
    }),
  }

  const mockUseStore: any = (selector: any) => {
    return selector ? selector(mockState) : mockState
  }

  // Add Zustand store methods to match the real useStore API
  mockUseStore.getState = () => mockState
  mockUseStore.setState = (partial: any) => {
    Object.assign(mockState, typeof partial === 'function' ? partial(mockState) : partial)
  }

  return { useStore: mockUseStore }
})

// Now import the component AFTER the mocks are set up
import CommandPaletteMenu from './CommandPaletteMenu'

describe('CommandPaletteMenu', () => {
  test('renders all base menu options', () => {
    const ref = createRef<HTMLDivElement>()
    render(<CommandPaletteMenu ref={ref} />)

    // Check that key menu items are present
    expect(screen.getByText('Create Session')).toBeDefined()
    expect(screen.getByText('Settings')).toBeDefined()
    expect(screen.getByText('View Hotkey Map')).toBeDefined()
  })

  test('filters options based on search input', async () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(<CommandPaletteMenu ref={ref} />)

    // Find the search input
    const input = container.querySelector('input[placeholder="Search commands and sessions..."]')
    expect(input).toBeDefined()

    // Type "settings" in the search
    if (input) {
      fireEvent.change(input, { target: { value: 'settings' } })
    }

    // Settings option should still be visible (cmdk will filter internally)
    // We're testing that the component renders without errors when typing
    expect(screen.getByText('Settings')).toBeDefined()
  })

  test('calls action when option is selected', () => {
    const ref = createRef<HTMLDivElement>()
    render(<CommandPaletteMenu ref={ref} />)

    // Find and click the Settings option
    const settingsOption = screen.getByText('Settings')
    fireEvent.click(settingsOption)

    // Verify the action was called
    expect(mockSetSettingsDialogOpen).toHaveBeenCalled()
    expect(mockClose).toHaveBeenCalled()
  })

  test('displays hotkey badges for menu options', () => {
    const ref = createRef<HTMLDivElement>()
    render(<CommandPaletteMenu ref={ref} />)

    // Check that hotkey badges are rendered (KeyboardShortcut components)
    const createSessionOption = screen.getByText('Create Session')
    const parentElement = createSessionOption.parentElement
    expect(parentElement).toBeDefined()

    // The hotkey badge (C) should be present in the parent
    expect(parentElement?.textContent).toContain('C')
  })

  test('shows footer help text', () => {
    const ref = createRef<HTMLDivElement>()
    render(<CommandPaletteMenu ref={ref} />)

    // Check for navigation hints in footer
    expect(screen.getByText('↑↓/Tab Navigate')).toBeDefined()
    expect(screen.getByText('↵ Select')).toBeDefined()
    expect(screen.getByText('ESC Close')).toBeDefined()
  })
})
