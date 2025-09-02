import { describe, test, expect } from 'bun:test'
import { renderHook } from '@testing-library/react'
import { useFileBrowser } from './useFileBrowser'

describe('useFileBrowser', () => {
  test('returns empty results for empty search path', () => {
    const { result } = renderHook(() => useFileBrowser(''))

    expect(result.current.results).toEqual([])
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  test('initializes with loading state for valid path', () => {
    const { result } = renderHook(() => useFileBrowser('/test'))

    // Should start loading immediately
    expect(result.current.isLoading).toBe(true)
    expect(result.current.results).toEqual([])
    expect(result.current.error).toBeNull()
  })

  test('accepts file browser options', () => {
    const options = {
      includeFiles: true,
      includeDirectories: false,
      fileExtensions: ['.ts', '.tsx'],
      maxResults: 5,
    }

    const { result } = renderHook(() => useFileBrowser('/test', options))

    // Hook should accept options without errors
    expect(result.current).toBeDefined()
  })

  test('handles different path formats', () => {
    // Test various path formats
    const paths = [
      '/absolute/path',
      '~/home/path',
      './relative/path',
      'simple',
      '/path/with/search',
    ]

    paths.forEach(path => {
      const { result } = renderHook(() => useFileBrowser(path))
      expect(result.current).toBeDefined()
      expect(result.current.isLoading).toBe(true)
    })
  })

  test('exports correct interface types', () => {
    // This test verifies that the types are exported correctly
    const options: Parameters<typeof useFileBrowser>[1] = {
      includeFiles: true,
      includeDirectories: true,
      fileExtensions: ['.ts'],
      maxResults: 10,
    }

    const { result } = renderHook(() => useFileBrowser('/test', options))
    
    // Check that the return type has the expected properties
    expect(result.current).toHaveProperty('results')
    expect(result.current).toHaveProperty('isLoading')
    expect(result.current).toHaveProperty('error')
  })
})