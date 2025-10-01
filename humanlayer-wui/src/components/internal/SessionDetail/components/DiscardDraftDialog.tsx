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

interface DiscardDraftDialogProps {
  open: boolean
  draftCount?: number
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardDraftDialog: React.FC<DiscardDraftDialogProps> = ({
  open,
  onConfirm,
  onCancel,
  draftCount,
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

  let draftHeaderText = 'Discard Draft?'
  let draftDescriptionText =
    'Are you sure you want to discard this draft session? This action cannot be undone.'

  if (typeof draftCount === 'number') {
    draftHeaderText = `Discard ${draftCount} Draft${draftCount > 1 ? 's' : ''}?`
    draftDescriptionText = `Are you sure you want to discard ${draftCount} draft session${draftCount > 1 ? 's' : ''}? This action cannot be undone and all unsaved changes will be lost.`
  }

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.DISCARD_DRAFT_DIALOG}
      isActive={open}
      rootScopeDisabled={true}
      componentName="DiscardDraftDialog"
    >
      <Dialog open={open} onOpenChange={onCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draftHeaderText}</DialogTitle>
            <DialogDescription>{draftDescriptionText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={onCancel}>
              Cancel
              <kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">Esc</kbd>
            </Button>
            <Button variant="destructive" onClick={onConfirm}>
              Discard
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
