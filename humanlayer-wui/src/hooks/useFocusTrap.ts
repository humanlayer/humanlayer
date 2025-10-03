import { useEffect, useRef } from 'react'

/**
 * Custom hook to trap focus within a container element.
 * Handles Tab and Shift+Tab navigation to cycle through focusable elements.
 * @param isActive - Whether the focus trap is active
 * @param options - Configuration options
 * @param options.allowTabNavigation - If true, Tab/Shift+Tab will not be trapped (useful for custom navigation)
 */
export function useFocusTrap(
  isActive: boolean,
  options?: {
    allowTabNavigation?: boolean
  },
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { allowTabNavigation = false } = options || {}

  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current

    // Find all focusable elements within the container
    const getFocusableElements = (): HTMLElement[] => {
      const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable="true"]',
      ].join(', ')

      const elements = container.querySelectorAll<HTMLElement>(focusableSelectors)
      // Filter out elements that are not visible or have display: none
      return Array.from(elements).filter(el => {
        const style = window.getComputedStyle(el)
        return style.display !== 'none' && style.visibility !== 'hidden'
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      // If Tab navigation is allowed for other purposes, don't trap it
      if (allowTabNavigation) return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) return

      const activeElement = document.activeElement as HTMLElement
      const currentIndex = focusableElements.indexOf(activeElement)

      // Prevent default tab behavior
      e.preventDefault()
      e.stopPropagation()

      let nextIndex: number

      if (e.shiftKey) {
        // Shift+Tab: Move backward
        if (currentIndex <= 0) {
          // If at the first element or not in the list, go to the last element
          nextIndex = focusableElements.length - 1
        } else {
          nextIndex = currentIndex - 1
        }
      } else {
        // Tab: Move forward
        if (currentIndex === -1 || currentIndex === focusableElements.length - 1) {
          // If at the last element or not in the list, go to the first element
          nextIndex = 0
        } else {
          nextIndex = currentIndex + 1
        }
      }

      // Focus the next element
      focusableElements[nextIndex].focus()
    }

    // Add event listener with capture to intercept before other handlers
    container.addEventListener('keydown', handleKeyDown, true)

    // Focus the first focusable element when the trap is activated
    const focusableElements = getFocusableElements()
    if (focusableElements.length > 0) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const firstInput = focusableElements.find(el => el.tagName === 'INPUT')
        if (firstInput) {
          firstInput.focus()
        } else {
          focusableElements[0].focus()
        }
      }, 50)
    }

    return () => {
      container.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [isActive, allowTabNavigation])

  return containerRef
}
