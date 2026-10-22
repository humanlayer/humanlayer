import { afterEach, expect, test, vi } from 'vitest'
import { mountResponseCaretLabels } from './response-caret-labels'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren() })

test('top-layer labels escape first-line and side clipping, follow scrolling, hide offscreen and clean up', () => {
  let frame: FrameRequestCallback | undefined
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1 })
  const cancel = vi.spyOn(window, 'cancelAnimationFrame')
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect })
  const editor = document.createElement('div')
  editor.style.overflowY = 'auto'
  editor.innerHTML = '<span class="response-caret"><span class="response-caret-label" popover="manual">Member</span></span>'
  document.body.append(editor)
  const caret = editor.firstElementChild as HTMLElement
  const label = caret.firstElementChild as HTMLElement
  label.showPopover = vi.fn()
  label.hidePopover = vi.fn()
  vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 100))
  const caretRect = vi.spyOn(caret, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 101, 2, 20))
  vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 150, 20))
  const mounted = mountResponseCaretLabels(editor)
  frame?.(0)
  expect(label.showPopover).toHaveBeenCalled()
  expect(label.style.top).toBe('81px') // Above the scroll viewport, not clipped inside it.
  expect(label.style.left).toBe('100px')
  caretRect.mockReturnValue(new DOMRect(299, 101, 2, 20))
  editor.dispatchEvent(new Event('scroll'))
  frame?.(0)
  expect(label.style.left).toBe('299px') // Can extend beyond the input's right edge.
  caretRect.mockReturnValue(new DOMRect(299, 210, 2, 20))
  editor.dispatchEvent(new Event('scroll'))
  frame?.(0)
  expect(label.hidePopover).toHaveBeenCalled()
  caretRect.mockReturnValue(new DOMRect(299, 101, 2, 20))
  mounted.update()
  frame?.(0)
  expect(label.showPopover).toHaveBeenCalledTimes(3)
  // A narrow window clamps the label, not the editor or its scroll behavior.
  vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, window.innerWidth, 100))
  caretRect.mockReturnValue(new DOMRect(window.innerWidth - 2, 101, 2, 20))
  mounted.update()
  frame?.(0)
  expect(label.style.left).toBe(`${window.innerWidth - 150}px`)
  mounted.update()
  mounted.destroy()
  expect(cancel).toHaveBeenCalled()
  expect(disconnect).toHaveBeenCalled()
  frame = undefined
  editor.dispatchEvent(new Event('scroll'))
  expect(frame).toBeUndefined()
})
