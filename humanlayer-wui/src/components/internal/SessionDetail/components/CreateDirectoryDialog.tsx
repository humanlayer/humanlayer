import React from 'react'
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

interface CreateDirectoryDialogProps {
  open: boolean
  directoryPath: string | null
  onConfirm: () => void
  onCancel: () => void
}

export const CreateDirectoryDialog: React.FC<CreateDirectoryDialogProps> = ({
  open,
  directoryPath,
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

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.CREATE_DIRECTORY_DIALOG}
      isActive={open}
      rootScopeDisabled={true}
      componentName="CreateDirectoryDialog"
    >
      <Dialog open={open} onOpenChange={onCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Directory?</DialogTitle>
            <DialogDescription className="pt-2 space-y-2">
              <p>The working directory does not exist:</p>
              <code className="block bg-secondary px-3 py-2 rounded text-sm font-mono break-all my-8">
                {directoryPath}
              </code>
              <p className="mb-4">Would you like to create this directory and launch the session?</p>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
              <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
            </Button>
            <Button variant="default" onClick={onConfirm}>
              Create & Launch
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
