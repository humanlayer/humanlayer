import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { AlertTriangle } from 'lucide-react'
import { useCallback, useState } from 'react'

import { Button } from './button'
import { Checkbox } from './checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { KeyboardShortcut } from './keyboard-shortcut'
import { Label } from './label'

export interface MultiplayerPromptingEnableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  isPending?: boolean
  hotkeyScope?: string
}

export function MultiplayerPromptingEnableDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
  hotkeyScope,
}: MultiplayerPromptingEnableDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setAcknowledged(false)
      onOpenChange(nextOpen)
    },
    [onOpenChange],
  )

  const handleConfirm = useCallback(() => {
    if (!acknowledged || isPending) return
    onConfirm()
  }, [acknowledged, isPending, onConfirm])

  useHotkeys(
    'mod+enter',
    (event) => {
      event.preventDefault()
      event.stopPropagation()
      handleConfirm()
    },
    {
      enabled: open && acknowledged && !isPending,
      enableOnFormTags: true,
      scopes: hotkeyScope ? [hotkeyScope] : undefined,
    },
    [open, acknowledged, isPending, handleConfirm, hotkeyScope],
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl" onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-amber-500" />
            Enable Multiplayer Prompting
          </DialogTitle>
          <DialogDescription>
            Multiplayer Prompting lets trusted collaborators send prompts to coding agents running on session
            owners&apos; machines.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-4 text-sm">
          Only enable this for an organization whose members you trust. Session owners should actively monitor shared
          sessions while collaborators have prompt access.
        </div>

        <Label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal">
          <Checkbox
            checked={acknowledged}
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
            aria-label="Acknowledge Multiplayer Prompting machine access warning"
          />
          <span>
            I understand collaborators will be able to run prompts on a session owner&apos;s machine.
          </span>
        </Label>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!acknowledged || isPending}>
            {isPending ? 'Enabling...' : 'Enable Multiplayer Prompting'}
            <KeyboardShortcut size="xs">⌘+ENTER</KeyboardShortcut>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
