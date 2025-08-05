import { FC, useState } from 'react'
import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle } from 'lucide-react'

interface DangerouslySkipPermissionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (timeoutMinutes: number | null) => void
}

export const DangerouslySkipPermissionsDialog: FC<DangerouslySkipPermissionsDialogProps> = ({
  open,
  onOpenChange,
  onConfirm,
}) => {
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | ''>(15)
  const [useTimeout, setUseTimeout] = useState(true)

  // Reset to default when dialog opens
  React.useEffect(() => {
    if (open) {
      setTimeoutMinutes(15)
      setUseTimeout(true)
    }
  }, [open])

  const handleConfirm = () => {
    const minutes = useTimeout ? (timeoutMinutes === '' ? 15 : timeoutMinutes) : null
    onConfirm(minutes)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[475px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[var(--terminal-error)] text-base font-bold">
            <AlertTriangle className="h-4 w-4" />
            Bypass Permissions
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                Bypassing permissions will <strong>automatically accept ALL tool calls</strong> without
                your approval. This includes:
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
        <div className="pb-0 pt-6">
          <div className="flex items-center justify-end space-x-2 min-h-[36px]">
            <Checkbox
              id="use-timeout"
              checked={useTimeout}
              onCheckedChange={(checked: boolean) => {
                setUseTimeout(checked)
                if (checked) {
                  setTimeout(() => {
                    const input = document.getElementById('timeout') as HTMLInputElement
                    if (input) {
                      input.focus()
                      input.setSelectionRange(input.value.length, input.value.length)
                    }
                  }, 0)
                }
              }}
            />
            <Label htmlFor="use-timeout">Auto-disable after</Label>
            {useTimeout ? (
              <>
                <Input
                  id="timeout"
                  type="number"
                  min="1"
                  max="60"
                  value={timeoutMinutes}
                  onChange={e => {
                    const value = e.target.value
                    if (value === '') {
                      setTimeoutMinutes('')
                    } else {
                      const parsed = parseInt(value)
                      if (!isNaN(parsed) && parsed >= 0) {
                        setTimeoutMinutes(parsed)
                      }
                    }
                  }}
                  className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>{timeoutMinutes === 1 ? 'minute' : 'minutes'}</span>
              </>
            ) : (
              <span>timeout</span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            disabled={useTimeout && (timeoutMinutes === '' || timeoutMinutes === 0)}
            className="border-[var(--terminal-error)] text-[var(--terminal-error)] hover:bg-[var(--terminal-error)] hover:text-background disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Bypass Permissions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
