import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileMentionList } from './FileMentionList'
import { useStore } from '@/AppStore'

// Mock the file browser hook
const mockUseFileBrowser = mock()
mock.module('@/hooks/useFileBrowser', () => ({
  useFileBrowser: mockUseFileBrowser,
}))

describe('FileMentionList', () => {
  const mockCommand = mock()
  const mockDispatch = mock()
  const mockReplaceRangeWith = mock()
  const mockText = mock(text => ({ type: 'text', text }))

  const mockEditor = {
    view: {
      state: {
        selection: { $from: { pos: 10 } },
        tr: {
          replaceRangeWith: mockReplaceRangeWith,
        },
        schema: {
          text: mockText,
        },
      },
      dispatch: mockDispatch,
    },
  }

  beforeEach(() => {
    mockCommand.mockClear()
    mockDispatch.mockClear()
    mockReplaceRangeWith.mockClear()
    mockText.mockClear()
    mockUseFileBrowser.mockClear()

    // Set up store with session working directory
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/project',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    // Default mock implementation
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    // Mock replaceRangeWith to return a transaction
    mockReplaceRangeWith.mockReturnThis()
  })

  test('displays loading state', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: true,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  test('displays error state', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: 'Permission denied',
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    expect(screen.getByText('Permission denied')).toBeInTheDocument()
  })

  test('displays no results message', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    expect(screen.getByText('No files found')).toBeInTheDocument()
  })

  test('displays files and folders with icons', async () => {
    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'App.tsx', isFile: true, isDirectory: false, fullPath: '/project/App.tsx' },
        { name: 'components', isDirectory: true, isFile: false, fullPath: '/project/components' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
      expect(screen.getByText('components')).toBeInTheDocument()
    })

    // Check for folder indicator
    const folderButton = screen.getByText('components').closest('button')
    expect(folderButton?.textContent).toContain('Press Enter to open')
  })

  test('handles file selection on click', async () => {
    mockUseFileBrowser.mockReturnValue({
      results: [{ name: 'App.tsx', isFile: true, isDirectory: false, fullPath: '/project/App.tsx' }],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('App.tsx')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('App.tsx'))

    expect(mockCommand).toHaveBeenCalledWith({
      id: '/project/App.tsx',
      label: 'App.tsx',
    })
  })

  test('navigates into folders on click', async () => {
    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'components', isDirectory: true, isFile: false, fullPath: '/project/components' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('components')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('components'))

    // Should update editor with new path
    expect(mockDispatch).toHaveBeenCalled()
    expect(mockText).toHaveBeenCalledWith('@components/')
  })

  test('handles special navigation to root', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [{ name: 'usr', isDirectory: true, isFile: false, fullPath: '/usr' }],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="/" command={mockCommand} editor={mockEditor} />)

    // Path should be set to root - header should show "Files & Folders"
    expect(screen.getByText('Files & Folders')).toBeInTheDocument()

    // Should be called with root path
    expect(mockUseFileBrowser).toHaveBeenCalledWith('/', expect.any(Object))
  })

  test('handles special navigation to home', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [{ name: 'Documents', isDirectory: true, isFile: false, fullPath: '~/Documents' }],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="~" command={mockCommand} editor={mockEditor} />)

    // Path should be set to home
    expect(screen.getByText('Files & Folders')).toBeInTheDocument()

    // Should be called with home path
    expect(mockUseFileBrowser).toHaveBeenCalledWith('~', expect.any(Object))
  })

  test('shows current path when not in default directory', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [{ name: 'file.ts', isFile: true, isDirectory: false, fullPath: '/other/path/file.ts' }],
      isLoading: false,
      error: null,
    })

    // Simulate being in a different directory
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/project',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    render(<FileMentionList query="/other/path/" command={mockCommand} editor={mockEditor} />)

    // Should show the current path in the header
    expect(screen.getByText(/in \/other\/path\//)).toBeInTheDocument()
  })

  test('uses session working directory as default', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/custom/project',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    // Should use session working directory
    expect(mockUseFileBrowser).toHaveBeenCalledWith('/custom/project', expect.any(Object))
  })

  test('falls back to home when no session working directory', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: undefined,
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    // Should fall back to home directory
    expect(mockUseFileBrowser).toHaveBeenCalledWith('~', expect.any(Object))
  })

  test('parses absolute path from root', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="/src/components" command={mockCommand} editor={mockEditor} />)

    // Should parse /src/components as searching for "components" in "/src" directory
    expect(mockUseFileBrowser).toHaveBeenCalledWith('/src/components', expect.any(Object))
  })

  test('parses absolute path from home', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="~/Documents/project" command={mockCommand} editor={mockEditor} />)

    // Should parse ~/Documents/project as searching for "project" in "~/Documents" directory
    expect(mockUseFileBrowser).toHaveBeenCalledWith('~/Documents/project', expect.any(Object))
  })

  test('handles relative path navigation', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="src/components/Button" command={mockCommand} editor={mockEditor} />)

    // Should build path from session working directory
    expect(mockUseFileBrowser).toHaveBeenCalledWith(
      '/project/src/components/Button',
      expect.any(Object),
    )
  })

  test('exposes keyboard handler via ref', () => {
    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'file1.ts', isFile: true, isDirectory: false, fullPath: '/project/file1.ts' },
        { name: 'file2.ts', isFile: true, isDirectory: false, fullPath: '/project/file2.ts' },
      ],
      isLoading: false,
      error: null,
    })

    const ref = { current: null as any }

    render(<FileMentionList ref={ref} query="" command={mockCommand} editor={mockEditor} />)

    // Should expose onKeyDown method
    expect(ref.current).toHaveProperty('onKeyDown')
    expect(typeof ref.current.onKeyDown).toBe('function')

    // Test keyboard navigation
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    const result = ref.current.onKeyDown({ event })
    expect(result).toBe(true) // Should handle the event
  })

  test('Tab key cycles forward through file mentions', () => {
    const files = [
      { name: 'file1.ts', isFile: true, isDirectory: false, fullPath: '/project/file1.ts' },
      { name: 'file2.ts', isFile: true, isDirectory: false, fullPath: '/project/file2.ts' },
      { name: 'file3.ts', isFile: true, isDirectory: false, fullPath: '/project/file3.ts' },
    ]

    mockUseFileBrowser.mockReturnValue({
      results: files,
      isLoading: false,
      error: null,
    })

    const ref = { current: null as any }
    render(<FileMentionList ref={ref} query="" command={mockCommand} editor={mockEditor} />)

    // Press Tab to cycle forward
    let event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false })
    let result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)

    // Press Tab again to cycle to third item
    event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false })
    result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)

    // Press Tab once more to cycle back to first item (wrapping)
    event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false })
    result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)
  })

  test('Shift+Tab cycles backward through file mentions', () => {
    const files = [
      { name: 'file1.ts', isFile: true, isDirectory: false, fullPath: '/project/file1.ts' },
      { name: 'file2.ts', isFile: true, isDirectory: false, fullPath: '/project/file2.ts' },
      { name: 'file3.ts', isFile: true, isDirectory: false, fullPath: '/project/file3.ts' },
    ]

    mockUseFileBrowser.mockReturnValue({
      results: files,
      isLoading: false,
      error: null,
    })

    const ref = { current: null as any }
    render(<FileMentionList ref={ref} query="" command={mockCommand} editor={mockEditor} />)

    // Press Shift+Tab to cycle backward (should wrap to last item)
    let event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    let result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)

    // Press Shift+Tab again to go to second-to-last item
    event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)

    // Press Shift+Tab once more
    event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true })
    result = ref.current.onKeyDown({ event })
    expect(result).toBe(true)
  })

  test('scrolls selected item into view', async () => {
    const mockScrollIntoView = mock()

    // Mock scrollIntoView on HTMLElement prototype
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    HTMLElement.prototype.scrollIntoView = mockScrollIntoView

    mockUseFileBrowser.mockReturnValue({
      results: Array.from({ length: 10 }, (_, i) => ({
        name: `file${i}.ts`,
        isFile: true,
        isDirectory: false,
        fullPath: `/project/file${i}.ts`,
      })),
      isLoading: false,
      error: null,
    })

    const ref = { current: null as any }

    render(<FileMentionList ref={ref} query="" command={mockCommand} editor={mockEditor} />)

    // Navigate down to trigger scroll
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' })
    const handled = ref.current?.onKeyDown({ event })
    expect(handled).toBe(true)

    // Wait for useEffect to trigger scrollIntoView
    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalled()
      expect(mockScrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      })
    })

    // Restore original scrollIntoView
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView
  })

  test('updates selection on hover', async () => {
    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'file1.ts', isFile: true, isDirectory: false, fullPath: '/project/file1.ts' },
        { name: 'file2.ts', isFile: true, isDirectory: false, fullPath: '/project/file2.ts' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('file1.ts')).toBeInTheDocument()
      expect(screen.getByText('file2.ts')).toBeInTheDocument()
    })

    const file2Button = screen.getByText('file2.ts').closest('button')

    // Hover over second file
    fireEvent.mouseEnter(file2Button!)

    // Should have selection indicator (border)
    expect(file2Button).toHaveClass('border-l-[var(--terminal-accent)]')
  })

  test('handles query without trailing slash when it matches a subdirectory', () => {
    // This test demonstrates the bug: when typing "@humanlayer" (without slash)
    // in a project where the working directory is /Users/nyx/dev/humanlayer/humanlayer,
    // it finds the subdirectory /Users/nyx/dev/humanlayer/humanlayer/humanlayer
    
    // Set up working directory
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/Users/nyx/dev/humanlayer/humanlayer',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'cli', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli' },
        { name: 'core', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/core' },
      ],
      isLoading: false,
      error: null,
    })

    // User types "@humanlayer" without trailing slash
    render(<FileMentionList query="humanlayer" command={mockCommand} editor={mockEditor} />)

    // The path becomes /Users/nyx/dev/humanlayer/humanlayer/humanlayer
    // because "humanlayer" is treated as a search/navigation term
    expect(mockUseFileBrowser).toHaveBeenCalledWith(
      '/Users/nyx/dev/humanlayer/humanlayer/humanlayer',
      expect.any(Object),
    )
  })

  test('handles query with trailing slash correctly', () => {
    // This test shows the behavior when user types "@humanlayer/" with a slash
    
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/Users/nyx/dev/humanlayer/humanlayer',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'cli', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli' },
        { name: 'core', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/core' },
      ],
      isLoading: false,
      error: null,
    })

    // User types "@humanlayer/" with trailing slash  
    render(<FileMentionList query="humanlayer/" command={mockCommand} editor={mockEditor} />)

    // With trailing slash, it treats "humanlayer" as a directory to navigate into
    // The path includes a trailing slash to list directory contents
    expect(mockUseFileBrowser).toHaveBeenCalledWith(
      '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/',
      expect.any(Object),
    )
  })

  test('clicking folder after query without slash preserves full path context', async () => {
    // This test verifies the fix: when clicking on a folder after typing "@humanlayer"
    // The navigation should preserve the full path context
    
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/Users/nyx/dev/humanlayer/humanlayer',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    // These are the actual results when searching for "humanlayer" in the working directory
    // The paths are correct - they exist at /Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli etc
    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'cli', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli' },
        { name: 'core', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/core' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="humanlayer" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('cli')).toBeInTheDocument()
    })

    // Click on the "cli" folder
    fireEvent.click(screen.getByText('cli'))

    // FIX: The editor should be updated with the relative path from the working directory
    // Since fullPath is /Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli
    // and workingDir is /Users/nyx/dev/humanlayer/humanlayer
    // The relative path should be "humanlayer/cli/"
    expect(mockDispatch).toHaveBeenCalled()
    expect(mockText).toHaveBeenCalledWith('@humanlayer/cli/')
    
    // Now when "@humanlayer/cli/" is processed, it will correctly resolve to
    // /Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli
  })

  test('handles absolute paths correctly when clicking folders', async () => {
    // Test that absolute paths are preserved when navigating outside working directory
    
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/project',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'bin', isDirectory: true, isFile: false, fullPath: '/usr/bin' },
        { name: 'lib', isDirectory: true, isFile: false, fullPath: '/usr/lib' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="/usr" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('bin')).toBeInTheDocument()
    })

    // Click on the "bin" folder  
    fireEvent.click(screen.getByText('bin'))

    // Should preserve absolute path since it's outside working directory
    expect(mockDispatch).toHaveBeenCalled()
    expect(mockText).toHaveBeenCalledWith('@/usr/bin/')
  })

  test('handles home directory paths correctly when clicking folders', async () => {
    // Test that home directory paths are preserved
    
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/project',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'Documents', isDirectory: true, isFile: false, fullPath: '~/Documents' },
        { name: 'Downloads', isDirectory: true, isFile: false, fullPath: '~/Downloads' },
      ],
      isLoading: false,
      error: null,
    })

    render(<FileMentionList query="~" command={mockCommand} editor={mockEditor} />)

    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument()
    })

    // Click on the "Documents" folder
    fireEvent.click(screen.getByText('Documents'))

    // Should preserve home directory path
    expect(mockDispatch).toHaveBeenCalled()
    expect(mockText).toHaveBeenCalledWith('@~/Documents/')
  })

  test('Enter key preserves full path context when navigating folders', () => {
    // Test that Enter key uses the same logic as clicking
    
    useStore.setState({
      activeSessionDetail: {
        session: {
          id: 'test-id',
          runId: 'test-run',
          status: 'active' as any,
          query: 'test query',
          createdAt: new Date(),
          lastActivityAt: new Date(),
          workingDir: '/Users/nyx/dev/humanlayer/humanlayer',
        },
        conversation: [],
        loading: false,
        error: null,
      },
    })

    mockUseFileBrowser.mockReturnValue({
      results: [
        { name: 'cli', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/cli' },
        { name: 'core', isDirectory: true, isFile: false, fullPath: '/Users/nyx/dev/humanlayer/humanlayer/humanlayer/core' },
      ],
      isLoading: false,
      error: null,
    })

    const ref = { current: null as any }
    render(<FileMentionList ref={ref} query="humanlayer" command={mockCommand} editor={mockEditor} />)

    // Press Enter to select the first item (cli)
    const event = new KeyboardEvent('keydown', { key: 'Enter' })
    const handled = ref.current?.onKeyDown({ event })
    expect(handled).toBe(true)

    // Should update the editor with the correct relative path
    expect(mockDispatch).toHaveBeenCalled()
    expect(mockText).toHaveBeenCalledWith('@humanlayer/cli/')
  })
})
