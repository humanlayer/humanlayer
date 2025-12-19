import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import React, { useState, useEffect } from 'react'
import { useStore } from '@/AppStore'
import { usePostHogTracking } from '@/hooks/usePostHogTracking'
import { POSTHOG_EVENTS } from '@/lib/telemetry/events'
import { logger } from '@/lib/logging'
import { toast } from 'sonner'
import { CheckCircle2, XCircle, RefreshCw, Pencil, Copy } from 'lucide-react'
import { HotkeyScopeBoundary } from './HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { clearSavedModelPreferences } from '@/hooks/useSessionLauncher'
import { invoke } from '@tauri-apps/api/core'
import { appLogDir } from '@tauri-apps/api/path'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { copyToClipboard } from '@/utils/clipboard'
import { HotkeySettings } from './HotkeySettings'

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
  const { trackEvent } = usePostHogTracking()
  const [saving, setSaving] = useState(false)
  const [claudePath, setClaudePath] = useState('')
  const [isUpdatingPath, setIsUpdatingPath] = useState(false)
  const [showClaudePathInput, setShowClaudePathInput] = useState(false)

  // Log-related state
  const [logPath, setLogPath] = useState<string>('')
  const [logLineCount, setLogLineCount] = useState<string>('500')
  const [copyingLogs, setCopyingLogs] = useState(false)

  // Fetch Claude config when dialog opens
  useEffect(() => {
    if (open) {
      fetchClaudeConfig()
      // Track settings opened event
      trackEvent(POSTHOG_EVENTS.SETTINGS_OPENED, {})
    }
  }, [open, fetchClaudeConfig, trackEvent])

  // Update local state when Claude config changes
  useEffect(() => {
    if (claudeConfig) {
      // Use detected path if no configured path, otherwise use configured path
      const pathToUse = claudeConfig.claudePath || claudeConfig.claudeDetectedPath || ''
      setClaudePath(pathToUse)
    }
  }, [claudeConfig])

  // Fetch log path when dialog opens
  useEffect(() => {
    if (open) {
      loadLogPath()
    }
  }, [open])

  async function loadLogPath() {
    try {
      const path = await invoke<string>('get_log_directory')
      setLogPath(path + '/codelayer.log')
    } catch {
      // In production, use appLogDir
      try {
        const appLog = await appLogDir()
        setLogPath(appLog + '/codelayer.log')
      } catch (e) {
        console.error('Failed to get log directory:', e)
        setLogPath('')
      }
    }
  }

  const handleProvidersToggle = async (checked: boolean) => {
    try {
      setSaving(true)

      // Clear saved model preferences when disabling advanced providers
      if (!checked) {
        clearSavedModelPreferences()
      }

      await updateUserSettings({ advancedProviders: checked })
      logger.log('Advanced providers setting updated:', checked)

      // Track settings change
      trackEvent(POSTHOG_EVENTS.SETTINGS_CHANGED, {
        setting_name: 'advanced_providers',
      })

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

      // Track telemetry opt-in/out events
      trackEvent(checked ? POSTHOG_EVENTS.TELEMETRY_OPT_IN : POSTHOG_EVENTS.TELEMETRY_OPT_OUT, {})

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

  const handleLogLineCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    // Only allow positive integers
    if (value === '' || /^[1-9][0-9]*$/.test(value)) {
      setLogLineCount(value)
    }
  }

  const handleCopyLogPath = async () => {
    if (!logPath) return
    await copyToClipboard(logPath)
    // The copyToClipboard utility already shows "Copied to clipboard" toast
  }

  const handleCopyLogLines = async () => {
    const lineCount = parseInt(logLineCount) || 500
    setCopyingLogs(true)

    try {
      const logContent = await invoke<string>('read_last_log_lines', {
        n: lineCount,
        logPath: logPath || undefined,
      })

      if (!logContent) {
        toast.info('Log file is empty')
        return
      }

      // Use writeText directly to show custom toast message
      await writeText(logContent)
      toast.success(`Copied last ${lineCount} lines to clipboard`)
    } catch (error) {
      console.error('Failed to read log file:', error)
      toast.error('Failed to copy log lines', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setCopyingLogs(false)
    }
  }

  return (
    <HotkeyScopeBoundary
      scope={HOTKEY_SCOPES.SETTINGS_MODAL}
      isActive={open}
      rootScopeDisabled={true}
      componentName="SettingsDialog"
    >
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
                    <>
                      Please check the configured path or use auto-detect to find Claude automatically.
                    </>
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

            {/* Logs Section */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Logs</Label>

              {/* Log Path Display */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-muted-foreground">Logs are stored at:</span>
                  <code className="text-xs bg-muted px-1 py-0.5 rounded flex-1 truncate">
                    {logPath || 'Loading...'}
                  </code>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 p-0"
                  onClick={handleCopyLogPath}
                  disabled={!logPath}
                  title="Copy log path"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>

              {/* Copy Last N Lines */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Copy last</span>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={logLineCount}
                  onChange={handleLogLineCountChange}
                  className="w-20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  placeholder="500"
                />
                <span className="text-sm text-muted-foreground">lines:</span>
                <Button size="sm" onClick={handleCopyLogLines} disabled={!logPath || copyingLogs}>
                  {copyingLogs ? 'Copying...' : 'Copy'}
                </Button>
              </div>
            </div>

            <div className="border-t border-border" />

            {/* Keyboard Shortcuts Section */}
            <HotkeySettings />
          </div>
        </DialogContent>
      </Dialog>
    </HotkeyScopeBoundary>
  )
}
