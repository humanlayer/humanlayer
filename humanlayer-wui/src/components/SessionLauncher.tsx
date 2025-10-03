import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { cn } from '@/lib/utils'
import type React from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import CommandInput from './CommandInput'
import CommandPaletteMenu from './CommandPaletteMenu'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { Card, CardContent } from './ui/card'

interface SessionLauncherProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionLauncher({ isOpen, onClose }: SessionLauncherProps) {
  const focusTrapRef = useFocusTrap(isOpen, {
    allowTabNavigation: true,
  })
  const { query, setQuery, config, setConfig, launchSession, isLaunching, error, mode, view, setView } =
    useSessionLauncher()

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

  useHotkeys(
    'meta+enter, ctrl+enter',
    e => {
      e.preventDefault()
      e.stopPropagation()
      handleSubmit()
    },
    {
      enabled: isOpen,
      enableOnFormTags: true, // Critical: allows the shortcut to work in form inputs
      scopes: [HOTKEY_SCOPES.SESSION_LAUNCHER],
      preventDefault: true,
    },
  )

  // Tab navigation is now handled by useFocusTrap hook

  // Scope is now managed by HotkeyScopeBoundary wrapper

  // Click outside to close
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  const handleSubmit = async () => {
    if (!query.trim()) return
    await launchSession()
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
        <Card
          ref={focusTrapRef}
          data-command-palette
          className={cn(
            'w-full max-w-2xl bg-background border-2 shadow-xl',
            'animate-in fade-in-0 zoom-in-95 duration-200',
          )}
          onKeyDown={e => {
            // Prevent Tab from escaping the modal
            if (e.key === 'Tab') {
              const focusableElements = focusTrapRef.current?.querySelectorAll(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
              )
              if (focusableElements && focusableElements.length > 0) {
                const firstElement = focusableElements[0] as HTMLElement
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement

                if (e.shiftKey && document.activeElement === firstElement) {
                  e.preventDefault()
                  lastElement.focus()
                } else if (!e.shiftKey && document.activeElement === lastElement) {
                  e.preventDefault()
                  firstElement.focus()
                }
              }
            }
          }}
        >
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">
                  {view === 'menu'
                    ? mode === 'command'
                      ? 'Command Palette'
                      : 'Jump to Session'
                    : 'Create Session'}
                </h2>
                <div className="flex items-center space-x-2">
                  {view === 'input' && (
                    <button
                      onClick={() => setView('menu')}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      ← Back
                    </button>
                  )}
                  <kbd className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">ESC</kbd>
                </div>
              </div>

              {view === 'menu' ? (
                <CommandPaletteMenu />
              ) : (
                <>
                  <CommandInput
                    value={query}
                    onChange={setQuery}
                    onSubmit={handleSubmit}
                    placeholder="Ask an agent..."
                    isLoading={isLaunching}
                    config={config}
                    onConfigChange={setConfig}
                  />

                  {error && (
                    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded p-3">
                      {error}
                    </div>
                  )}

                  <div className="flex items-center justify-end text-xs text-muted-foreground">
                    <div className="flex items-center space-x-2">
                      <span>ESC Close</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </HotkeyScopeBoundary>
  )
}
