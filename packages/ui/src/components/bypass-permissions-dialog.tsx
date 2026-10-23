import { Button } from '@humanlayer/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

export interface BypassPermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (timeoutMinutes: number | null) => void
  sessionCount?: number
  /** Optional hotkey scope for proper scope-based hotkey handling */
  hotkeyScope?: string
}

export function BypassPermissionsDialog({
  open,
  onOpenChange,
  onConfirm,
  sessionCount,
  hotkeyScope,
}: BypassPermissionsDialogProps) {
  const handleConfirm = useCallback(() => {
    onConfirm(null)
    onOpenChange(false)
  }, [onConfirm, onOpenChange])

  const handleEscape = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  // Hotkey handlers using useHotkeys (when hotkeyScope is provided)
  useHotkeys(
    'mod+enter',
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleConfirm()
    },
    {
      enabled: open && !!hotkeyScope,
      enableOnFormTags: true,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
    },
    [open, handleConfirm, hotkeyScope],
  )

  useHotkeys(
    'escape',
    (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleEscape()
    },
    {
      enabled: open && !!hotkeyScope,
      enableOnFormTags: true,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
    },
    [open, handleEscape, hotkeyScope],
  )

  // Fallback: Handle keyboard shortcuts with document listener (when no hotkeyScope)
  useEffect(() => {
    // Skip if using hotkey scope
    if (hotkeyScope) return
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Escape
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleEscape()
        return
      }

      // Handle Cmd+Enter or Ctrl+Enter
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        handleConfirm()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleConfirm, handleEscape, hotkeyScope])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="overflow-hidden"
        style={{ width: 'min(90%, 35rem)', maxWidth: 'min(90%, 35rem)' }}
        onEscapeKeyDown={(e) => {
          // Prevent the default Dialog escape handling
          // Our custom escape handler will handle it
          e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          // Prevent closing when clicking outside
          e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--terminal-error)] text-base font-bold">
            <AlertTriangle className="h-4 w-4" />
            Bypass Permissions
            {sessionCount && sessionCount > 1 && ` for ${sessionCount} Sessions`}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Bypassing permissions will <strong>automatically accept ALL tool calls</strong> without your
                approval
                {sessionCount && sessionCount > 1 ? ` for all ${sessionCount} selected sessions` : ''}. This
                includes:
              </p>
              <ul className="list-disc list-inside space-y-1">
                <li>File edits and writes</li>
                <li>Running bash commands</li>
                <li>Reading files</li>
                <li>Spawning sub-tasks</li>
                <li>All MCP tool calls</li>
              </ul>
              <p className="text-[var(--terminal-error)] font-semibold">Use with extreme caution!</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            className="border-[var(--terminal-error)] text-[var(--terminal-error)] hover:bg-[var(--terminal-error)] hover:text-background focus-visible:border-[var(--terminal-error)] focus-visible:ring-[var(--terminal-error)]/50"
          >
            {sessionCount && sessionCount > 1
              ? `Bypass Permissions for ${sessionCount} Sessions`
              : 'Bypass Permissions'}
            <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
              {typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl'}+ENTER
            </kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
