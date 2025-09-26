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

interface DiscardDraftsDialogProps {
  open: boolean
  draftCount: number
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardDraftsDialog: React.FC<DiscardDraftsDialogProps> = ({
  open,
  draftCount,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard {draftCount} Draft{draftCount > 1 ? 's' : ''}?</DialogTitle>
          <DialogDescription>
            Are you sure you want to discard {draftCount} draft session{draftCount > 1 ? 's' : ''}?
            This action cannot be undone and all unsaved changes will be lost.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Discard {draftCount > 1 ? `${draftCount} Drafts` : 'Draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}