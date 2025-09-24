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

interface DiscardDraftDialogProps {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

export const DiscardDraftDialog: React.FC<DiscardDraftDialogProps> = ({
  open,
  onConfirm,
  onCancel
}) => {
  return (
    <Dialog open={open} onOpenChange={onCancel}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard Draft?</DialogTitle>
          <DialogDescription>
            Are you sure you want to discard this draft session? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}