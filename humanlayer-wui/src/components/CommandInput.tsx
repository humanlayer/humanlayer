import { useRef, useEffect, useState } from 'react'
import { Button } from './ui/button'
import { SearchInput } from './FuzzySearchInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { Textarea } from './ui/textarea'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { hasContent, isEmptyOrWhitespace } from '@/utils/validation'
import { Eye, EyeOff, Pencil, CheckCircle, AlertCircle } from 'lucide-react'
import { daemonClient } from '@/lib/daemon'
import { ConfigStatus } from '@/lib/daemon/types'
import { useStore } from '@/AppStore'

interface SessionConfig {
  title?: string
  workingDir: string
  provider?: 'anthropic' | 'openrouter'
  model?: string
  maxTurns?: number
  openRouterApiKey?: string
}

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  isLoading?: boolean
  config?: SessionConfig
  onConfigChange?: (config: SessionConfig) => void
}

export default function CommandInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Enter your command...',
  isLoading = false,
  config = { workingDir: '' },
  onConfigChange,
}: CommandInputProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const directoryRef = useRef<HTMLInputElement>(null)
  const { paths: recentPaths } = useRecentPaths()
  const [showApiKey, setShowApiKey] = useState(false)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [isCheckingConfig, setIsCheckingConfig] = useState(false)
  const userSettings = useStore(state => state.userSettings)

  useEffect(() => {
    // Focus on directory field if it has the default value, otherwise focus on prompt
    if (config.workingDir === '~/') {
      // Focus on directory field when it has the default value
      const directoryInput = directoryRef.current?.querySelector('input')
      if (directoryInput) {
        directoryInput.focus()
      }
    } else if (promptRef.current) {
      // Focus on prompt field for normal usage
      promptRef.current.focus()
    }
  }, [])

  // Check config status when provider changes to OpenRouter
  useEffect(() => {
    if (config.provider === 'openrouter') {
      setIsCheckingConfig(true)
      daemonClient
        .getConfigStatus()
        .then(setConfigStatus)
        .catch(err => {
          console.error('Failed to check config:', err)
        })
        .finally(() => setIsCheckingConfig(false))
    }
  }, [config.provider])

  const getPlatformKey = () => {
    return navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'
  }

  const updateConfig = (updates: Partial<SessionConfig>) => {
    if (onConfigChange) {
      onConfigChange({ ...config, ...updates })
    }
  }

  return (
    <div className="space-y-4">
      {/* Working Directory Field with Fuzzy Search */}
      <div className="space-y-2">
        <Label>Working Directory</Label>
        <SearchInput
          ref={directoryRef}
          value={config.workingDir}
          onChange={value => onConfigChange?.({ ...config, workingDir: value })}
          onSubmit={onSubmit}
          placeholder="/path/to/directory or leave empty for current directory"
          recentDirectories={recentPaths}
        />
      </div>

      {/* Title Field (optional) */}
      <div className="space-y-2">
        <Label htmlFor="title">Title (optional)</Label>
        <Input
          id="title"
          type="text"
          value={config.title || ''}
          onChange={e => onConfigChange?.({ ...config, title: e.target.value })}
          placeholder="Optional session title"
          disabled={isLoading}
        />
      </div>

      {/* Main query input */}
      <div className="relative space-y-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          ref={promptRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground mt-1">
          <kbd className="px-1 py-0.5 bg-muted/50 rounded">Enter</kbd> for new line
        </p>

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-r-transparent rounded-full" />
          </div>
        )}
      </div>

      {/* Provider and Model Selection - Only show if advanced providers is enabled */}
      {userSettings?.advancedProviders ? (
        <div className="grid grid-cols-2 gap-4">
          {/* Provider Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Provider</label>
            <Select
              value={config.provider || 'anthropic'}
              onValueChange={value => {
                updateConfig({
                  provider: value as 'anthropic' | 'openrouter',
                  model: undefined, // Clear model when provider changes
                  // Keep the API key persistent across provider changes
                })
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Model</label>

            {config.provider === 'openrouter' ? (
              // Text input for OpenRouter models
              <Input
                type="text"
                value={config.model || ''}
                onChange={e => updateConfig({ model: e.target.value })}
                placeholder="e.g., openai/gpt-oss-120b"
                disabled={isLoading}
              />
            ) : (
              // Dropdown for Anthropic models
              <Select
                value={config.model || ''}
                onValueChange={value => updateConfig({ model: value || undefined })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="System Default" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                  <SelectItem value="opus">Opus</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      ) : (
        // When advanced providers is disabled, just show model selection for Anthropic
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Model</label>
          <Select
            value={config.model || ''}
            onValueChange={value => updateConfig({ model: value || undefined })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="System Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sonnet">Sonnet</SelectItem>
              <SelectItem value="opus">Opus</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* OpenRouter API Key field - only shown when OpenRouter is selected */}
      {config.provider === 'openrouter' && (
        <div className="space-y-2">
          {!showApiKeyInput ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isCheckingConfig ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : configStatus?.openrouter?.api_key_configured || config.openRouterApiKey ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                <span
                  className={
                    configStatus?.openrouter?.api_key_configured || config.openRouterApiKey
                      ? 'text-sm text-muted-foreground'
                      : 'text-sm text-destructive'
                  }
                >
                  {isCheckingConfig
                    ? 'Checking OpenRouter configuration...'
                    : configStatus?.openrouter?.api_key_configured || config.openRouterApiKey
                      ? 'OpenRouter API key is configured'
                      : 'OpenRouter API key required'}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="api-key" className="text-xs">
                OpenRouter API Key
              </Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={config.openRouterApiKey || ''}
                    onChange={e => updateConfig({ openRouterApiKey: e.target.value })}
                    placeholder="sk-or-..."
                    className="h-8 pr-10 text-sm"
                  />
                  {config.openRouterApiKey && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-8 w-8 p-0"
                      onClick={() => setShowApiKey(!showApiKey)}
                      type="button"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  )}
                </div>
                {config.openRouterApiKey ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => {
                      setShowApiKeyInput(false)
                      setShowApiKey(false)
                    }}
                    type="button"
                  >
                    Save
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => {
                      setShowApiKeyInput(false)
                      updateConfig({ openRouterApiKey: undefined })
                      setShowApiKey(false)
                    }}
                    type="button"
                  >
                    Cancel
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Your API key will be stored with this session
              </p>
            </div>
          )}
        </div>
      )}

      {/* Action Bar */}
      {hasContent(value) && (
        <div className="flex items-center justify-end pt-2">
          <Button
            onClick={onSubmit}
            disabled={isEmptyOrWhitespace(value) || isLoading}
            size="sm"
            className="font-mono"
          >
            {isLoading ? (
              <>
                <div className="animate-spin h-3 w-3 border border-current border-r-transparent rounded-full mr-2" />
                Launching...
              </>
            ) : (
              <>
                Launch Session
                <kbd className="ml-2 px-1 py-0.5 text-xs bg-muted/50 rounded">{getPlatformKey()}+⏎</kbd>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
