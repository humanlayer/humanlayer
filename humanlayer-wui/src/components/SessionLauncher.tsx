import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'
import { cn } from '@/lib/utils'
import type React from 'react'
import { useEffect, useRef } from 'react'
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
  console.log(`[HOTKEY-DEBUG] SessionLauncher render: isOpen=${isOpen}`)
  const modalRef = useRef<HTMLDivElement>(null)
  const { query, setQuery, config, setConfig, launchSession, isLaunching, error, mode, view, setView } =
    useSessionLauncher()

  useHotkeys(
    'escape',
    e => {
      console.log('[HOTKEY-DEBUG] Escape pressed in SessionLauncher')
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
        console.log('[HOTKEY-DEBUG] Blurring input')
        ;(activeElement as HTMLElement).blur()
      } else {
        // Second ESC or ESC when no input focused: close modal
        console.log('[HOTKEY-DEBUG] Closing SessionLauncher')
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

  // Capture Shift+Tab to prevent bubbling to background session
  useHotkeys(
    'shift+tab',
    e => {
      e.preventDefault()
      e.stopPropagation()
      // Use native event for complete isolation
      const keyEvent = e as any
      if (keyEvent.nativeEvent && typeof keyEvent.nativeEvent.stopImmediatePropagation === 'function') {
        keyEvent.nativeEvent.stopImmediatePropagation()
      }
      // Let browser handle the actual navigation but prevent bubbling
    },
    {
      enabled: isOpen,
      enableOnFormTags: true,
      scopes: [HOTKEY_SCOPES.SESSION_LAUNCHER],
      preventDefault: true,
    },
  )

  // Scope is now managed by HotkeyScopeBoundary wrapper

  useEffect(() => {
    if (isOpen && view === 'input' && modalRef.current) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        // Look for the directory input specifically (it's the first input in the form)
        const directoryInput = modalRef.current?.querySelector('input[type="text"]')
        if (directoryInput) {
          ;(directoryInput as HTMLInputElement).focus()
          console.log('[HOTKEY-DEBUG] Focused directory input in SessionLauncher')
        }
      }, 50)
    }
  }, [isOpen, view])

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
          ref={modalRef}
          data-command-palette
          className={cn(
            'w-full max-w-2xl bg-background border-2 shadow-xl',
            'animate-in fade-in-0 zoom-in-95 duration-200',
          )}
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
