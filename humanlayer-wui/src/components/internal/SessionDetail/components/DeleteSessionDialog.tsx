import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useHotkeys } from 'react-hotkeys-hook'
import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

interface DeleteSessionDialogProps {
  open: boolean
  sessionCount?: number
  onConfirm: () => void
  onCancel: () => void
}

export const DeleteSessionDialog: React.FC<DeleteSessionDialogProps> = ({
  open,
  sessionCount = 1,
  onConfirm,
  onCancel,
}) => {
  const isMac = navigator.platform.includes('Mac')

  useHotkeys(
    'mod+enter',
    () => {
      if (open) {
        onConfirm()
      }
    },
    { enabled: open, enableOnFormTags: true },
  )

  useHotkeys(
    'escape',
    ev => {
      ev.preventDefault()
      ev.stopPropagation()
      onCancel()
    },
    { enabled: open, enableOnFormTags: true, preventDefault: true },
  )

  const title = sessionCount > 1 ? `Delete ${sessionCount} Sessions?` : 'Delete Session?'

  const description =
    sessionCount > 1
      ? `This will permanently delete ${sessionCount} sessions and all their conversation history. This action cannot be undone.`
      : 'This will permanently delete this session and all its conversation history. This action cannot be undone.'

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.DELETE_SESSION_DIALOG}
      isActive={open}
      rootScopeDisabled={true}
      componentName="DeleteSessionDialog"
    >
      <Dialog open={open} onOpenChange={isOpen => !isOpen && onCancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {title}
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
              <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              Delete
              <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
                {isMac ? '⌘+Enter' : 'Ctrl+Enter'}
              </kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HotkeyScopeBoundary>
  )
}
