import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import type { ConversationEvent } from '@/lib/daemon/types'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

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

import { useSessionNavigation } from './useSessionNavigation'

const createRect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect

const createEvent = (id: number): ConversationEvent =>
  ({
    id,
    eventType: 'message',
    role: 'assistant',
    content: `event ${id}`,
  }) as ConversationEvent

const renderNavigation = () =>
  renderHook(() =>
    useSessionNavigation({
      events: [createEvent(1), createEvent(2), createEvent(3)],
      hasSubTasks: false,
      expandedTasks: new Set(),
      toggleTaskGroup: mock(() => {}),
      scope: HOTKEY_SCOPES.SESSION_DETAIL,
    }),
  )

const setupConversation = (rects: Record<number, DOMRect>) => {
  const container = document.createElement('div')
  const scrollBy = mock(() => {})

  container.setAttribute('data-conversation-container', '')
  Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true })
  container.getBoundingClientRect = () => createRect(0, 100)
  ;(container as HTMLElement).scrollBy = scrollBy

  Object.keys(rects).forEach(id => {
    const element = document.createElement('div')
    element.setAttribute('data-event-id', id)
    element.getBoundingClientRect = () => rects[Number(id)]
    element.scrollIntoView = mock(() => {})
    container.appendChild(element)
  })

  document.body.appendChild(container)

  return { scrollBy }
}

const focusEvent = (result: ReturnType<typeof renderNavigation>['result'], id: number) => {
  act(() => {
    result.current.setFocusedEventId(id)
    result.current.setFocusSource('mouse')
  })
}

const press = (key: string) => {
  const handler = hotkeyHandlers.get(key)
  if (!handler) {
    throw new Error(`No hotkey handler registered for ${key}`)
  }

  act(() => {
    handler()
  })
}

describe('useSessionNavigation', () => {
  beforeEach(() => {
    hotkeyHandlers.clear()
    document.body.innerHTML = ''
  })

  it('j on a short focused message jumps to the next event', () => {
    const { scrollBy } = setupConversation({
      1: createRect(0, 80),
      2: createRect(80, 100),
      3: createRect(100, 120),
    })
    const { result } = renderNavigation()
    focusEvent(result, 1)

    press('j')

    expect(result.current.focusedEventId).toBe(2)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('j scrolls a long focused message before changing focus', () => {
    const { scrollBy } = setupConversation({
      1: createRect(0, 260),
      2: createRect(260, 280),
      3: createRect(280, 300),
    })
    const { result } = renderNavigation()
    focusEvent(result, 1)

    press('j')

    expect(result.current.focusedEventId).toBe(1)
    expect(scrollBy).toHaveBeenCalledWith({ top: 80, behavior: 'smooth' })
  })

  it('repeated j presses reveal a long message before jumping to the next event', () => {
    const rects = {
      1: createRect(0, 260),
      2: createRect(260, 280),
      3: createRect(280, 300),
    }
    const { scrollBy } = setupConversation(rects)
    const { result } = renderNavigation()
    focusEvent(result, 1)

    press('j')
    rects[1] = createRect(-80, 180)
    press('j')
    rects[1] = createRect(-160, 100)
    press('j')

    expect(result.current.focusedEventId).toBe(2)
    expect(scrollBy).toHaveBeenCalledTimes(2)
  })

  it('k scrolls a long focused message upward before changing focus', () => {
    const { scrollBy } = setupConversation({
      1: createRect(-180, -160),
      2: createRect(-160, 100),
      3: createRect(100, 120),
    })
    const { result } = renderNavigation()
    focusEvent(result, 2)

    press('k')

    expect(result.current.focusedEventId).toBe(2)
    expect(scrollBy).toHaveBeenCalledWith({ top: -80, behavior: 'smooth' })
  })

  it('ArrowDown and ArrowUp jump events without scroll-within-message behavior', () => {
    const { scrollBy } = setupConversation({
      1: createRect(0, 260),
      2: createRect(-160, 100),
      3: createRect(100, 120),
    })
    const { result } = renderNavigation()
    focusEvent(result, 1)

    press('ArrowDown')
    expect(result.current.focusedEventId).toBe(2)

    press('ArrowUp')
    expect(result.current.focusedEventId).toBe(1)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
