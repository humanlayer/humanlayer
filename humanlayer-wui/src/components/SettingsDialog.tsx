import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useState } from 'react'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'

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
    } catch (error) {
      logger.error('Failed to update settings:', error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="advanced-providers" className="text-sm font-medium">
                Advanced Providers
              </Label>
              <p className="text-sm text-muted-foreground">
                Enable alternative AI providers and models
              </p>
              <p
                className="text-sm text-muted-foreground transition-opacity"
                style={{
                  opacity: userSettings?.advancedProviders ? 1 : 0,
                  visibility: userSettings?.advancedProviders ? 'visible' : 'hidden',
                }}
              >
                ⚠️ Warning: Using non-Claude models and providers is experimental.
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
      </DialogContent>
    </Dialog>
  )
}
