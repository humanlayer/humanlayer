import { describe, it, expect, beforeEach } from 'bun:test'
import { renderHook } from '@testing-library/react'
import { useAutoScroll } from './useAutoScroll'
import { useStore } from '@/AppStore'

describe('useAutoScroll', () => {
  beforeEach(() => {
    // Reset store state
    useStore.getState().setAutoScrollEnabled(true)
  })

  const createMockContainer = (scrollTop: number, scrollHeight: number, clientHeight: number) => {
    return {
      current: {
        scrollTop,
        scrollHeight,
        clientHeight,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as HTMLDivElement,
    }
  }

  it('should be enabled by default', () => {
    const { result } = renderHook(() => useAutoScroll({ current: null }, false, false))
    expect(result.current.autoScrollEnabled).toBe(true)
  })

  it('should detect when at bottom', () => {
    const mockContainer = createMockContainer(900, 1000, 100)

    const { result } = renderHook(() => useAutoScroll(mockContainer as any, false, false))

    expect(result.current.isAtBottom()).toBe(true)
  })

  it('should detect when not at bottom', () => {
    const mockContainer = createMockContainer(500, 1000, 100)

    const { result } = renderHook(() => useAutoScroll(mockContainer as any, false, false))

    expect(result.current.isAtBottom()).toBe(false)
  })

  it('should use percentage-based threshold', () => {
    const mockContainer = createMockContainer(898, 1000, 100)

    const { result } = renderHook(() => useAutoScroll(mockContainer as any, false, false))

    // Should be at bottom since 2px < 2.5px (2.5% of 100px viewport)
    expect(result.current.isAtBottom()).toBe(true)
  })
})
