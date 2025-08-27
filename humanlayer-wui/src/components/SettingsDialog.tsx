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
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
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

  const handleClaudePathUpdate = async () => {
    try {
      setIsUpdatingPath(true)
      await updateClaudePath(claudePath)
      await fetchClaudeConfig() // Refresh to get availability status

      if (claudeConfig?.claudeAvailable) {
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
      await updateClaudePath('')
      await fetchClaudeConfig() // Refresh to get new detected path

      // After fetching, the config will have the detected path
      const detectedPath = claudeConfig?.claudeDetectedPath || claudeConfig?.claudePath

      if (detectedPath) {
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

            <div className="space-y-2">
              <Label htmlFor="claude-path">Claude Binary Path</Label>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
