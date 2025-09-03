import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, RefreshCw, Pencil } from 'lucide-react'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfigUpdate?: () => Promise<void> // Add optional callback
}

export function SettingsDialog({ open, onOpenChange, onConfigUpdate }: SettingsDialogProps) {
  const userSettings = useStore(state => state.userSettings)
  const updateUserSettings = useStore(state => state.updateUserSettings)
  const claudeConfig = useStore(state => state.claudeConfig)
  const fetchClaudeConfig = useStore(state => state.fetchClaudeConfig)
  const updateClaudePath = useStore(state => state.updateClaudePath)
  const [saving, setSaving] = useState(false)
  const [claudePath, setClaudePath] = useState('')
  const [isUpdatingPath, setIsUpdatingPath] = useState(false)
  const [showClaudePathInput, setShowClaudePathInput] = useState(false)

  // Fetch Claude config when dialog opens
  useEffect(() => {
    if (open) {
      fetchClaudeConfig()
    }
  }, [open, fetchClaudeConfig])

  // Update local state when Claude config changes
  useEffect(() => {
    if (claudeConfig) {
      // Use detected path if no configured path, otherwise use configured path
      const pathToUse = claudeConfig.claudePath || claudeConfig.claudeDetectedPath || ''
      setClaudePath(pathToUse)
    }
  }, [claudeConfig])

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

  const handleClaudePathUpdate = async () => {
    try {
      setIsUpdatingPath(true)
      const updateResponse = await updateClaudePath(claudePath)

      // Trigger immediate health check if callback provided
      if (onConfigUpdate) {
        await onConfigUpdate()
      }

      // Use the response directly instead of stale claudeConfig
      if (updateResponse?.claudeAvailable) {
        toast.success('Claude Path Updated', {
          description: 'Claude binary was found at the specified path.',
        })
      } else {
        toast.warning('Claude Path Updated', {
          description: 'Path was updated but Claude binary was not found at this location.',
        })
      }
    } catch (error) {
      logger.error('Failed to update Claude path:', error)
      toast.error('Failed to Update Claude Path', {
        description: 'Could not update the Claude path. Please try again.',
      })
    } finally {
      setIsUpdatingPath(false)
    }
  }

  const handleAutoDetect = async () => {
    try {
      setIsUpdatingPath(true)
      // Empty string triggers auto-detection
      const updateResponse = await updateClaudePath('')

      // Trigger immediate health check
      if (onConfigUpdate) {
        await onConfigUpdate()
      }

      // Use response to determine if detection succeeded
      const detectedPath = updateResponse?.claudeDetectedPath || updateResponse?.claudePath

      if (detectedPath && updateResponse?.claudeAvailable) {
        toast.success('Claude Auto-Detection Complete', {
          description: `Claude binary found at: ${detectedPath}`,
        })
      } else {
        toast.warning('Claude Not Found', {
          description: 'Could not auto-detect Claude binary. Please specify the path manually.',
        })
      }
    } catch (error) {
      logger.error('Failed to auto-detect Claude:', error)
      toast.error('Auto-Detection Failed', {
        description: 'Could not auto-detect Claude path. Please try again.',
      })
    } finally {
      setIsUpdatingPath(false)
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

          <div className="space-y-2">
            <Label htmlFor="claude-path" className="text-sm font-medium">Claude Binary Path</Label>
            {!showClaudePathInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {claudeConfig?.claudeAvailable ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span
                    className={
                      claudeConfig?.claudeAvailable
                        ? 'text-sm text-muted-foreground'
                        : 'text-sm text-destructive'
                    }
                  >
                    {claudeConfig?.claudeAvailable ? (
                      <>
                        Claude binary {claudeConfig.claudePath ? 'configured' : 'detected'} at:{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {claudeConfig.claudePath || claudeConfig.claudeDetectedPath}
                        </code>
                      </>
                    ) : (
                      'Claude binary not found'
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setShowClaudePathInput(!showClaudePathInput)}
                    title="Edit Claude path"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    onClick={handleAutoDetect}
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    disabled={isUpdatingPath}
                    title="Auto-detect Claude binary"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    id="claude-path"
                    placeholder="/usr/local/bin/claude or leave empty for auto-detect"
                    value={claudePath}
                    onChange={e => setClaudePath(e.target.value)}
                    disabled={isUpdatingPath}
                    className="flex-1"
                  />
                  <Button
                    onClick={() => {
                      handleClaudePathUpdate()
                      setShowClaudePathInput(false)
                    }}
                    size="sm"
                    disabled={isUpdatingPath}
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowClaudePathInput(false)
                      // Reset to current configured/detected path
                      if (claudeConfig) {
                        const pathToUse =
                          claudeConfig.claudePath || claudeConfig.claudeDetectedPath || ''
                        setClaudePath(pathToUse)
                      }
                    }}
                    disabled={isUpdatingPath}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Specify the path to the Claude binary or leave empty for auto-detection
                </p>
              </div>
            )}
            {claudeConfig && !claudeConfig.claudeAvailable && (
              <p className="text-xs text-amber-500">
                Claude is not available. Sessions will run with limited functionality. Install Claude
                CLI from{' '}
                <a href="https://claude.ai/code" className="underline" target="_blank">
                  claude.ai/code
                </a>
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}