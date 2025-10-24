import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type React from 'react'
import { useHotkeys } from '@/hooks/useHotkeys'
import CommandPaletteMenu from './CommandPaletteMenu'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'

interface SessionLauncherProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionLauncher({ isOpen, onClose }: SessionLauncherProps) {
  const focusTrapRef = useFocusTrap(isOpen, {
    allowTabNavigation: true,
  })

  useHotkeys(
    'escape',
    e => {
      e.preventDefault()
      e.stopPropagation()

      // Check if an input is currently focused
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        (activeElement as HTMLElement)?.contentEditable === 'true'

      if (isInputFocused) {
        // First ESC: just blur the input
        ;(activeElement as HTMLElement).blur()
      } else {
        // Second ESC or ESC when no input focused: close modal
        onClose()
      }
    },
    {
      enabled: isOpen,
      enableOnFormTags: true,
      scopes: [HOTKEY_SCOPES.SESSION_LAUNCHER],
    },
  )

  // Click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.SESSION_LAUNCHER}
      isActive={isOpen}
      rootScopeDisabled={true}
      componentName="SessionLauncher"
    >
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={handleOverlayClick}
      >
        <CommandPaletteMenu ref={focusTrapRef} />
      </div>
    </HotkeyScopeBoundary>
  )
}
