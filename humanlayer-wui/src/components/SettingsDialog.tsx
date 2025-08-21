import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { toast } from 'sonner'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const userSettings = useStore(state => state.userSettings)
  const updateUserSettings = useStore(state => state.updateUserSettings)
  const [saving, setSaving] = useState(false)

  const handleProvidersToggle = async (checked: boolean) => {
    try {
      setSaving(true)
      await updateUserSettings({ advancedProviders: checked })
      logger.log('Advanced providers setting updated:', checked)

      // Show toast notification
      if (checked) {
        toast.success('Advanced Providers Enabled', {
          description:
            'OpenRouter and other alternative AI providers are now available in the session launcher.',
        })
      } else {
        toast.info('Advanced Providers Disabled', {
          description: 'Only Anthropic models will be available in the session launcher.',
        })
      }
    } catch (error) {
      logger.error('Failed to update settings:', error)
      toast.error('Failed to Update Setting', {
        description: 'Could not update the advanced providers setting. Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label htmlFor="advanced-providers">Advanced Providers</Label>
                <p className="text-xs text-muted-foreground">
                  Enable OpenRouter and future alternative AI providers
                </p>
              </div>
              <Switch
                id="advanced-providers"
                checked={userSettings?.advancedProviders ?? false}
                onCheckedChange={handleProvidersToggle}
                disabled={!userSettings || saving}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
