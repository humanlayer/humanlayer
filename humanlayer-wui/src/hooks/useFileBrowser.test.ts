import { describe, test, expect, beforeEach, mock } from 'bun:test'
import { renderHook, waitFor } from '@testing-library/react'

// Mock the imports before importing the module under test
const mockReadDir = mock<() => Promise<any[]>>(() => Promise.resolve([]))
const mockHomeDir = mock<() => Promise<string>>(() => Promise.resolve('/Users/test'))
const mockFuzzySearch = mock<(items: any[]) => any[]>((items: any[]) =>
  items.map((item: any) => ({ item, matches: [] })),
)

// Mock the modules
mock.module('@tauri-apps/plugin-fs', () => ({
  readDir: mockReadDir,
}))

mock.module('@tauri-apps/api/path', () => ({
  homeDir: mockHomeDir,
}))

mock.module('@/lib/fuzzy-search', () => ({
  fuzzySearch: mockFuzzySearch,
}))

// Now import the module under test
import { useFileBrowser } from './useFileBrowser'

describe('useFileBrowser', () => {
  beforeEach(() => {
    mockReadDir.mockClear()
    mockHomeDir.mockClear()
    mockFuzzySearch.mockClear()
    mockHomeDir.mockResolvedValue('/Users/test')
    mockReadDir.mockResolvedValue([])

    // Default fuzzy search behavior - return all items
    mockFuzzySearch.mockImplementation((items: any[]) => {
      return items.map((item: any) => ({ item, matches: [] }))
    })
  })

  test('returns empty results for empty search path', () => {
    const { result } = renderHook(() => useFileBrowser(''))

    expect(result.current.results).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  test('expands home directory in paths', async () => {
    mockReadDir.mockResolvedValueOnce([
      { name: 'file.ts', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() => useFileBrowser('~/Documents/', { includeFiles: true }))

    // Wait for the debounce timeout (150ms) and loading to complete
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
        expect(result.current.results.length).toBeGreaterThan(0)
      },
      { timeout: 1000 },
    )

    expect(mockHomeDir).toHaveBeenCalled()
    expect(mockReadDir).toHaveBeenCalledWith('/Users/test/Documents')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].fullPath).toBe('/Users/test/Documents/file.ts')
  })

  test('treats single word as search query not directory navigation', async () => {
    // When given a single word like "humanlayer", it should search for it
    // in the current directory rather than trying to navigate into it
    mockReadDir.mockResolvedValueOnce([
      { name: 'humanlayer', isFile: false, isDirectory: true, isSymlink: false },
      { name: 'humanlayer-go', isFile: false, isDirectory: true, isSymlink: false },
      { name: 'humanlayer-tui', isFile: false, isDirectory: true, isSymlink: false },
    ])

    const { result } = renderHook(() => useFileBrowser('humanlayer'))

    // Wait for debounce and loading
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
        // Check that results were populated
        if (result.current.results.length > 0) {
          return true
        }
        throw new Error('Waiting for results')
      },
      { timeout: 500 },
    )

    // Should read from current directory and search for "humanlayer"
    expect(mockReadDir).toHaveBeenCalledWith('.')
    // Should return fuzzy search results
    expect(result.current.results.length).toBeGreaterThan(0)
  })

  test('navigates into directory when path ends with slash', async () => {
    // When path ends with slash, should list directory contents
    mockReadDir.mockResolvedValueOnce([
      { name: 'cli', isFile: false, isDirectory: true, isSymlink: false },
      { name: 'core', isFile: false, isDirectory: true, isSymlink: false },
    ])

    const { result } = renderHook(() => useFileBrowser('humanlayer/'))

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
        if (result.current.results.length > 0) {
          return true
        }
        throw new Error('Waiting for results')
      },
      { timeout: 500 },
    )

    // Should read the "humanlayer" directory
    expect(mockReadDir).toHaveBeenCalledWith('humanlayer')
    // Should list directory contents without search
    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].name).toBe('cli')
    expect(result.current.results[1].name).toBe('core')
  })

  test('searches for query in absolute path directories', async () => {
    // When given an absolute path with a search term, should search in that directory
    mockReadDir.mockResolvedValueOnce([
      { name: 'README.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'release.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'package.json', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('/Users/test/project/release', { includeFiles: true }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
        if (result.current.results.length > 0) {
          return true
        }
        throw new Error('Waiting for results')
      },
      { timeout: 500 },
    )

    // Should search in the /Users/test/project directory for "release"
    expect(mockReadDir).toHaveBeenCalledWith('/Users/test/project')
    // Fuzzy search should find release.md
    expect(result.current.results.length).toBeGreaterThan(0)
  })

  test('lists directory contents when path has trailing slash', async () => {
    // When given a path with trailing slash, should list directory contents
    mockReadDir.mockResolvedValueOnce([
      { name: 'README.md', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'package.json', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'src', isFile: false, isDirectory: true, isSymlink: false },
    ])

    const { result } = renderHook(() => useFileBrowser('/Users/test/project/', { includeFiles: true }))

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
        if (result.current.results.length > 0) {
          return true
        }
        throw new Error('Waiting for results')
      },
      { timeout: 500 },
    )

    // Should read the directory
    expect(mockReadDir).toHaveBeenCalledWith('/Users/test/project')
    // Should show all files and directories
    expect(result.current.results).toHaveLength(3)
    expect(result.current.results.map(r => r.name)).toContain('README.md')
    expect(result.current.results.map(r => r.name)).toContain('package.json')
    expect(result.current.results.map(r => r.name)).toContain('src')
  })
})
