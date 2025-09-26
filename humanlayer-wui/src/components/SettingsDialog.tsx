import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useStore } from '@/AppStore'
import { logger } from '@/lib/logging'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, RefreshCw, Pencil, FileJson } from 'lucide-react'

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
  const [customMcpConfig, setCustomMcpConfig] = useState('')
  const [showMcpConfigInput, setShowMcpConfigInput] = useState(false)

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

  // Update local state when user settings change
  useEffect(() => {
    if (userSettings) {
      setCustomMcpConfig(userSettings.customMcpConfig || '')
    }
  }, [userSettings])

  const handleProvidersToggle = async (checked: boolean) => {
    try {
      setSaving(true)
      await updateUserSettings({ advancedProviders: checked })
      logger.log('Advanced providers setting updated:', checked)
      toast.success(checked ? 'Advanced providers enabled' : 'Advanced providers disabled')
    } catch (error) {
      logger.error('Failed to update settings:', error)
      toast.error('Failed to update settings', {
        description: 'Please try again or check your connection.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTelemetryToggle = async (checked: boolean) => {
    try {
      setSaving(true)
      await updateUserSettings({ optInTelemetry: checked })
      logger.log('Telemetry opt-in setting updated:', checked)
      if (checked) {
        toast.success('Error reporting enabled', {
          description: 'Thank you for helping us improve CodeLayer!',
        })
      } else {
        toast.success('Error reporting disabled', {
          description: 'Error and performance data will no longer be sent to CodeLayer.',
        })
      }
    } catch (error) {
      logger.error('Failed to update telemetry settings:', error)
      toast.error('Failed to update telemetry settings', {
        description: 'Please try again or check your connection.',
      })
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

  const handleMcpConfigUpdate = async () => {
    try {
      setSaving(true)
      await updateUserSettings({ customMcpConfig: customMcpConfig.trim() })
      logger.log('MCP config path updated:', customMcpConfig)
      toast.success('MCP Configuration Updated', {
        description: customMcpConfig
          ? `MCP config will be loaded from: ${customMcpConfig}`
          : 'MCP configuration path cleared',
      })
      setShowMcpConfigInput(false)
    } catch (error) {
      logger.error('Failed to update MCP config path:', error)
      toast.error('Failed to Update MCP Configuration', {
        description: 'Could not update the MCP configuration path. Please try again.',
      })
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

          <div className="space-y-2">
            <Label htmlFor="claude-path" className="text-sm font-medium">
              Claude Binary Path
            </Label>
            {!showClaudePathInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {claudeConfig?.claudeAvailable ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-destructive" />
                  )}
                  <div className="flex flex-col">
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
                      ) : claudeConfig?.claudePath ? (
                        <>
                          Claude binary not found at configured path:{' '}
                          <code className="text-xs bg-muted px-1 py-0.5 rounded">
                            {claudeConfig.claudePath}
                          </code>
                        </>
                      ) : (
                        'Claude binary could not be auto-detected'
                      )}
                    </span>
                    {/* Display version information */}
                    {claudeConfig?.claudeAvailable && claudeConfig.claudeVersion && (
                      <span className="text-xs text-muted-foreground">
                        Version:{' '}
                        <code className="bg-muted px-1 py-0.5 rounded">
                          {claudeConfig.claudeVersion}
                        </code>
                      </span>
                    )}
                    {/* Display version error if version check failed */}
                    {claudeConfig?.claudeAvailable && claudeConfig.claudeVersionError && (
                      <span className="text-xs text-amber-500">
                        Version check failed: {claudeConfig.claudeVersionError}
                      </span>
                    )}
                  </div>
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
                {claudeConfig?.claudePath ? (
                  <>Please check the configured path or use auto-detect to find Claude automatically.</>
                ) : (
                  <>
                    Claude is not available. Install Claude CLI from{' '}
                    <a href="https://claude.ai/code" className="underline" target="_blank">
                      claude.ai/code
                    </a>
                  </>
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="mcp-config" className="text-sm font-medium">
              Custom MCP Configuration
            </Label>
            {!showMcpConfigInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {customMcpConfig || 'No custom MCP configuration file specified'}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setShowMcpConfigInput(!showMcpConfigInput)}
                  title="Edit MCP config path"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    id="mcp-config"
                    placeholder="/path/to/mcp-config.json or leave empty to use defaults"
                    value={customMcpConfig}
                    onChange={e => setCustomMcpConfig(e.target.value)}
                    disabled={saving}
                    className="flex-1"
                  />
                  <Button onClick={handleMcpConfigUpdate} size="sm" disabled={saving}>
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowMcpConfigInput(false)
                      // Reset to current configured path
                      if (userSettings) {
                        setCustomMcpConfig(userSettings.customMcpConfig || '')
                      }
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Specify the path to a custom MCP configuration JSON file that will be merged with
                  default MCP servers
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="telemetry-opt-in" className="text-sm font-medium">
                Performance & Error Reporting
              </Label>
              <p className="text-sm text-muted-foreground">
                Share anonymous error reports and performance data
              </p>
            </div>
            <Switch
              id="telemetry-opt-in"
              checked={userSettings?.optInTelemetry ?? false}
              onCheckedChange={handleTelemetryToggle}
              disabled={!userSettings || saving}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
