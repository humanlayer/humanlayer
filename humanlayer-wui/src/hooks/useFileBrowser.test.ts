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
    // Set up the mock to:
    // 1. First call succeeds (checking if ~/Documents is a directory)
    // 2. Second call returns the directory contents
    mockReadDir
      .mockResolvedValueOnce([]) // First call when checking if it's a directory
      .mockResolvedValueOnce([{ name: 'file.ts', isFile: true, isDirectory: false, isSymlink: false }])

    const { result } = renderHook(() => useFileBrowser('~/Documents', { includeFiles: true }))

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
})
