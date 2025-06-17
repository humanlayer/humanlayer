import React, { useEffect, useRef } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { Card, CardContent } from './ui/card'
import { cn } from '@/lib/utils'
import CommandInput from './CommandInput'
import { useSessionLauncher } from '@/hooks/useSessionLauncher'

interface SessionLauncherProps {
  isOpen: boolean
  onClose: () => void
}

export function SessionLauncher({ isOpen, onClose }: SessionLauncherProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const { query, setQuery, launchSession, isLaunching, error, mode } = useSessionLauncher()

  // Escape key to close
  useHotkeys('escape', onClose, { enabled: isOpen })

  // Focus management
  useEffect(() => {
    if (isOpen && modalRef.current) {
      const input = modalRef.current.querySelector('input')
      input?.focus()
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
                {mode === 'command' ? 'Launch Session' : 'Search Sessions'}
              </h2>
              <kbd className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">ESC</kbd>
            </div>

            <CommandInput
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              placeholder={
                mode === 'command'
                  ? 'Enter your prompt to start a session...'
                  : 'Search sessions and approvals...'
              }
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
                {mode === 'command' && query.startsWith('/') && (
                  <span className="text-blue-500">Working directory detected</span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <span>↵ {mode === 'command' ? 'Launch' : 'Search'}</span>
                <span>⌘K Close</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
