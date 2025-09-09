import { useState } from 'react'
import { useStore } from '@/AppStore'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Shield, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

interface OptInTelemetryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OptInTelemetryModal({ open, onOpenChange }: OptInTelemetryModalProps) {
  const { updateUserSettings } = useStore()
  const [isUpdating, setIsUpdating] = useState(false)

  const handleOptIn = async (enable: boolean) => {
    setIsUpdating(true)
    try {
      await updateUserSettings({ optInTelemetry: enable })
      onOpenChange(false)
      if (enable) {
        toast.success('Error reporting enabled', {
          description: 'Thank you for helping us improve CodeLayer!',
        })
      }
    } catch (error) {
      console.error('Failed to update diagnostic metrics setting:', error)
      toast.error('Failed to update settings', {
        description: 'Please try again or check your connection.',
      })
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-blue-600" />
            <DialogTitle>Performance & Error Reporting Opt-In</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            Share anonymous performance data and error reports to help us improve your experience and
            fix issues faster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <h4 className="flex items-center gap-2 text-sm font-medium text-[var(--terminal-accent)] mb-2">
              <Eye className="h-4 w-4" />
              What we collect:
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• JavaScript errors and crash reports</li>
              <li>• Performance metrics (load times, memory usage)</li>
            </ul>
          </div>

          <div>
            <h4 className="flex items-center gap-2 text-sm font-medium text-destructive mb-2">
              <EyeOff className="h-4 w-4" />
              We NEVER collect:
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1 ml-6">
              <li>• Your prompts or conversations</li>
              <li>• Code contents or file paths</li>
              <li>• API keys or personal information</li>
              <li>• Working directory names</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="gap-3 mt-4">
          <Button tabIndex={2} variant="ghost" onClick={() => handleOptIn(false)} disabled={isUpdating}>
            No Thanks
          </Button>
          <Button
            tabIndex={1}
            variant="default"
            onClick={() => handleOptIn(true)}
            disabled={isUpdating}
          >
            {isUpdating ? 'Saving...' : 'Enable Reporting'}
          </Button>
        </DialogFooter>
        <div className="bg-muted/50 p-3 rounded-lg text-xs uppercase tracking-wider">
          <p className="text-xs text-muted-foreground text-right">
            You can change this preference anytime in Settings
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
