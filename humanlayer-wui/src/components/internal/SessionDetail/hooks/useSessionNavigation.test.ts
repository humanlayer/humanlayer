import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import type { ConversationEvent } from '@/lib/daemon/types'

const hotkeyHandlers = new Map<string, () => void>()

mock.module('@humanlayer/hld-sdk', () => ({
  SessionStatus: {},
  ApprovalStatus: {},
}))

mock.module('react-hotkeys-hook', () => ({
  useHotkeys: (keys: string, callback: () => void) => {
    hotkeyHandlers.set(keys, callback)
  },
}))

const { useSessionNavigation } = await import('./useSessionNavigation')

const events = [1, 2, 3].map(
  id =>
    ({
      id,
      eventType: 'message',
    }) as ConversationEvent,
)

const rect = (top: number, bottom: number) =>
  ({
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => {},
  }) as DOMRect

const renderNavigation = () =>
  renderHook(() =>
    useSessionNavigation({
      events,
      hasSubTasks: false,
      expandedTasks: new Set(),
      toggleTaskGroup: () => {},
      scope: HOTKEY_SCOPES.SESSION_DETAIL,
    }),
  )

const pressHotkey = (key: string) => {
  const handler = hotkeyHandlers.get(key)
  if (!handler) throw new Error(`No handler registered for ${key}`)

  act(() => {
    handler()
  })
}

const setupEventBounds = ({
  eventId,
  top,
  height,
  containerHeight = 100,
}: {
  eventId: number
  top: number
  height: number
  containerHeight?: number
}) => {
  const scrollCalls: number[] = []
  const container = document.createElement('div')
  container.setAttribute('data-conversation-container', '')
  container.getBoundingClientRect = () => rect(0, containerHeight)
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: containerHeight })
  container.scrollBy = ((options: ScrollToOptions) => {
    const delta = options.top ?? 0
    scrollCalls.push(delta)
    container.scrollTop += delta
  }) as typeof container.scrollBy

  events.forEach(event => {
    const element = document.createElement('div')
    element.setAttribute('data-event-id', String(event.id))
    element.getBoundingClientRect = () => {
      if (event.id !== eventId) return rect(0, 20)

      const currentTop = top - container.scrollTop
      return rect(currentTop, currentTop + height)
    }
    container.appendChild(element)
  })

  document.body.appendChild(container)

  return scrollCalls
}

beforeEach(() => {
  hotkeyHandlers.clear()
  document.body.innerHTML = ''
  Element.prototype.scrollIntoView = () => {}
})

describe('useSessionNavigation', () => {
  it('j on a short visible message jumps to the next event', () => {
    const { result } = renderNavigation()
    setupEventBounds({ eventId: 1, top: 0, height: 80 })

    act(() => result.current.setFocusedEventId(1))
    pressHotkey('j')

    expect(result.current.focusedEventId).toBe(2)
  })

  it('j on a long message scrolls down without changing focus', () => {
    const { result } = renderNavigation()
    const scrollCalls = setupEventBounds({ eventId: 1, top: 0, height: 260 })

    act(() => result.current.setFocusedEventId(1))
    pressHotkey('j')

    expect(result.current.focusedEventId).toBe(1)
    expect(scrollCalls).toEqual([80])
  })

  it('repeated j reveals a long message before jumping to the next event', () => {
    const { result } = renderNavigation()
    const scrollCalls = setupEventBounds({ eventId: 1, top: 0, height: 260 })

    act(() => result.current.setFocusedEventId(1))
    pressHotkey('j')
    pressHotkey('j')
    pressHotkey('j')

    expect(scrollCalls).toEqual([80, 80])
    expect(result.current.focusedEventId).toBe(2)
  })

  it('k scrolls up within a long message before jumping to the previous event', () => {
    const { result } = renderNavigation()
    const scrollCalls = setupEventBounds({ eventId: 2, top: 0, height: 260 })

    act(() => {
      result.current.setFocusedEventId(2)
    })

    const container = document.querySelector('[data-conversation-container]') as HTMLElement
    container.scrollTop = 160

    pressHotkey('k')
    pressHotkey('k')
    pressHotkey('k')

    expect(scrollCalls).toEqual([-80, -80])
    expect(result.current.focusedEventId).toBe(1)
  })

  it('ArrowDown and ArrowUp jump events without scroll-aware pre-checks', () => {
    const { result } = renderNavigation()
    const scrollCalls = setupEventBounds({ eventId: 2, top: -160, height: 260 })

    act(() => result.current.setFocusedEventId(2))

    pressHotkey('ArrowDown')
    expect(result.current.focusedEventId).toBe(3)

    pressHotkey('ArrowUp')
    expect(result.current.focusedEventId).toBe(2)
    expect(scrollCalls).toEqual([])
  })
})
