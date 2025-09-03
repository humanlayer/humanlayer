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

  test.skip('expands home directory in paths', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'file.ts', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() => useFileBrowser('~/Documents', { includeFiles: true }))

    // Wait for the initial loading state to resolve
    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(mockHomeDir).toHaveBeenCalled()
    expect(mockReadDir).toHaveBeenCalledWith('/Users/test/Documents')
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0].fullPath).toBe('/Users/test/Documents/file.ts')
  })

  test.skip('handles directory listing with trailing slash', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'subdir', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'file.ts', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('/project/', { includeFiles: true, includeDirectories: true }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(mockReadDir).toHaveBeenCalledWith('/project')
    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].name).toBe('subdir')
    expect(result.current.results[1].name).toBe('file.ts')
  })

  test.skip('filters by file extensions', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'component.tsx', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'styles.css', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'utils.ts', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('/src', {
        includeFiles: true,
        fileExtensions: ['.ts', '.tsx'],
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].name).toBe('component.tsx')
    expect(result.current.results[1].name).toBe('utils.ts')
  })

  test.skip('filters directories when includeDirectories is false', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'src', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'file1.ts', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'node_modules', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'file2.ts', isFile: true, isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('/project', {
        includeFiles: true,
        includeDirectories: false,
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(result.current.results).toHaveLength(2)
    expect(result.current.results.every(r => r.isFile)).toBe(true)
  })

  test.skip('applies fuzzy search when search query exists', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'AppStore.ts', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'AppRouter.tsx', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'Button.tsx', isFile: true, isDirectory: false, isSymlink: false },
    ])

    // Mock fuzzy search to filter results
    mockFuzzySearch.mockImplementation((items: any[]) => {
      return items
        .filter((item: any) => item.name.toLowerCase().includes('app'))
        .map((item: any) => ({ item, matches: [] }))
    })

    const { result } = renderHook(() =>
      useFileBrowser('/src/App', {
        includeFiles: true,
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(mockFuzzySearch).toHaveBeenCalled()
    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[0].name).toBe('AppStore.ts')
    expect(result.current.results[1].name).toBe('AppRouter.tsx')
  })

  test.skip('handles readDir errors gracefully', async () => {
    mockReadDir.mockRejectedValue(new Error('Permission denied'))

    const { result } = renderHook(() => useFileBrowser('/restricted'))

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(result.current.error).toBe('Permission denied')
    expect(result.current.results).toEqual([])
  })

  test.skip('respects maxResults limit', async () => {
    const manyFiles = Array.from({ length: 20 }, (_, i) => ({
      name: `file${i}.ts`,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    }))
    mockReadDir.mockResolvedValue(manyFiles)

    const { result } = renderHook(() =>
      useFileBrowser('/many', {
        includeFiles: true,
        maxResults: 5,
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(result.current.results).toHaveLength(5)
  })

  test.skip('handles special case for root directory', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'usr', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'bin', isDirectory: true, isFile: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('/', {
        includeDirectories: true,
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(mockReadDir).toHaveBeenCalledWith('/')
    expect(result.current.results).toHaveLength(2)
  })

  test.skip('handles special case for home directory', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isFile: false, isSymlink: false },
      { name: 'Downloads', isDirectory: true, isFile: false, isSymlink: false },
    ])

    const { result } = renderHook(() =>
      useFileBrowser('~', {
        includeDirectories: true,
      }),
    )

    await waitFor(
      () => {
        expect(result.current.isLoading).toBe(false)
      },
      { timeout: 500 },
    )

    expect(mockHomeDir).toHaveBeenCalled()
    expect(mockReadDir).toHaveBeenCalledWith('/Users/test')
    expect(result.current.results).toHaveLength(2)
  })
})
