import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { AlertTriangle, ShieldOff } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

export interface BypassPermissionsNudgeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (timeoutMinutes: number | null) => void
  sessionCount?: number
  /** Optional hotkey scope for proper scope-based hotkey handling */
  hotkeyScope?: string
  /** Called with true on confirm if the "Don't show me this again" checkbox is checked. */
  onSilencedChange?: (silenced: boolean) => void
}

export function BypassPermissionsNudgeDialog({
  open,
  onOpenChange,
  onConfirm,
  sessionCount,
  hotkeyScope,
  onSilencedChange,
}: BypassPermissionsNudgeDialogProps) {
  const [localDontShow, setLocalDontShow] = useState(false)

  const handleConfirm = useCallback(() => {
    if (localDontShow && onSilencedChange) {
      onSilencedChange(true)
    }
    onConfirm(null)
    onOpenChange(false)
    setLocalDontShow(false)
  }, [onConfirm, onOpenChange, localDontShow, onSilencedChange])

  const handleEscape = useCallback(() => {
    onOpenChange(false)
    setLocalDontShow(false)
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
            {sessionCount && sessionCount > 1
              ? <>Enable <strong>Bypass Permissions</strong> for {sessionCount} sessions?</>
              : <>Enable <strong>Bypass Permissions</strong> for this session?</>}
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
        <p className="text-muted-foreground text-xs">
          Toggle at anytime with <kbd className="px-1 py-0.5 bg-muted/50 rounded font-mono">⌥+Y</kbd> or
          the <ShieldOff className="inline h-3.5 w-3.5 align-text-bottom" /> button in the bottom left.
        </p>
        <div className="flex items-center space-x-2 py-2">
          <Checkbox
            id="bypass-nudge-dont-show"
            checked={localDontShow}
            onCheckedChange={(checked) => {
              setLocalDontShow(checked === true)
              if (checked && onSilencedChange) {
                onSilencedChange(true)
              }
            }}
          />
          <Label htmlFor="bypass-nudge-dont-show" className="text-sm text-muted-foreground cursor-pointer">
            Don't show me this again
          </Label>
        </div>
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
