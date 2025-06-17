import React, { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Card, CardContent } from './ui/card'
import { cn } from '@/lib/utils'
import CommandInput from './CommandInput'
import CommandPaletteMenu from './CommandPaletteMenu'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'

interface SessionLauncherProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionLauncher({ isOpen, onClose }: SessionLauncherProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const { query, setQuery, launchSession, isLaunching, error, mode, view, setView } =
    useSessionLauncher()

  // Escape key to close - enable even when input is focused
  useHotkeys('escape', onClose, { enabled: isOpen, enableOnFormTags: true })

  // Focus management
  useEffect(() => {
    if (isOpen && view === 'input' && modalRef.current) {
      const input = modalRef.current.querySelector('input')
      input?.focus()
    }
  }, [isOpen, view])

  // Additional escape key handler for input field
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

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
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleOverlayClick}
    >
      <Card
        ref={modalRef}
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
                    : 'Search Sessions'
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
              <CommandPaletteMenu onClose={onClose} />
            ) : (
              <>
                <CommandInput
                  value={query}
                  onChange={setQuery}
                  onSubmit={handleSubmit}
                  placeholder="Enter your prompt to start a session..."
                  isLoading={isLaunching}
                />

                {error && (
                  <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded p-3">
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center space-x-4">
                    <span>Characters: {query.length}</span>
                    {query.startsWith('/') && (
                      <span className="text-blue-500">Working directory detected</span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span>↵ Launch</span>
                    <span>⌘K Close</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
