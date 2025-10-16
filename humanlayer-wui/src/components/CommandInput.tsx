import { useRef, useEffect, useState } from 'react'
import { Button } from './ui/button'
import { SearchInput } from './FuzzySearchInput'
import { MultiDirectoryInput } from './MultiDirectoryInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { Textarea } from './ui/textarea'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { hasContent, isEmptyOrWhitespace } from '@/utils/validation'
import { ProviderApiKeyField } from './ProviderApiKeyField'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { daemonClient } from '@/lib/daemon'
import { ConfigStatus } from '@/lib/daemon/types'
import { useStore } from '@/AppStore'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

interface SessionConfig {
  title?: string
  workingDir: string
  provider?: 'anthropic' | 'openrouter' | 'baseten'
  model?: string
  maxTurns?: number
  openRouterApiKey?: string
  basetenApiKey?: string
  additionalDirectories?: string[]
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
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [isCheckingConfig, setIsCheckingConfig] = useState(false)
  const userSettings = useStore(state => state.userSettings)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

  useEffect(() => {
    // Always focus on the directory field first
    const directoryInput = directoryRef.current?.querySelector('input')
    if (directoryInput) {
      directoryInput.focus()
    }
  }, [])

  // Check config status when provider changes to OpenRouter or Baseten
  useEffect(() => {
    if (config.provider === 'openrouter' || config.provider === 'baseten') {
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
          onChange={value => updateConfig({ workingDir: value })}
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
          onChange={e => updateConfig({ title: e.target.value })}
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
                const newProvider = value as 'anthropic' | 'openrouter' | 'baseten'

                // Get the saved model for this provider
                let savedModel: string | undefined
                if (newProvider === 'anthropic') {
                  savedModel = localStorage.getItem('humanlayer-model') || undefined
                } else if (newProvider === 'openrouter') {
                  savedModel = localStorage.getItem('humanlayer-openrouter-model') || undefined
                } else if (newProvider === 'baseten') {
                  savedModel = localStorage.getItem('humanlayer-baseten-model') || undefined
                }

                updateConfig({
                  provider: newProvider,
                  model: savedModel,
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
                <SelectItem value="baseten">Baseten</SelectItem>
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
            ) : config.provider === 'baseten' ? (
              // Text input for Baseten models
              <Input
                type="text"
                value={config.model || ''}
                onChange={e => updateConfig({ model: e.target.value })}
                placeholder="e.g., deepseek-ai/DeepSeek-V3.1"
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
                  <SelectItem value="haiku">Haiku</SelectItem>
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
        <ProviderApiKeyField
          provider="openrouter"
          displayName="OpenRouter"
          apiKey={config.openRouterApiKey}
          isConfigured={configStatus?.openrouter?.api_key_configured}
          isCheckingConfig={isCheckingConfig}
          placeholder="sk-or-..."
          onApiKeyChange={value => updateConfig({ openRouterApiKey: value })}
        />
      )}

      {/* Baseten API Key field - only shown when Baseten is selected */}
      {config.provider === 'baseten' && (
        <ProviderApiKeyField
          provider="baseten"
          displayName="Baseten"
          apiKey={config.basetenApiKey}
          isConfigured={configStatus?.baseten?.api_key_configured}
          isCheckingConfig={isCheckingConfig}
          placeholder=""
          onApiKeyChange={value => updateConfig({ basetenApiKey: value })}
        />
      )}

      {/* Warning for non-Anthropic providers */}
      {config.provider && config.provider !== 'anthropic' && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 border border-border rounded-md text-sm text-muted-foreground">
          <span>⚠️</span>
          <span>Warning: Using non-Claude models and providers is experimental.</span>
        </div>
      )}

      {/* Advanced Settings Collapsible */}
      <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
        <CollapsibleTrigger className="flex items-center cursor-pointer text-sm font-medium text-foreground hover:opacity-80 p-0">
          {isAdvancedOpen ? (
            <ChevronDown className="h-4 w-4 mr-1" />
          ) : (
            <ChevronRight className="h-4 w-4 mr-1" />
          )}
          <span>Advanced Settings</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-4">
          {/* Additional Directories Field */}
          <MultiDirectoryInput
            directories={config.additionalDirectories || []}
            onDirectoriesChange={directories => updateConfig({ additionalDirectories: directories })}
            recentDirectories={recentPaths}
            placeholder="Add additional directories for Claude to access..."
          />
        </CollapsibleContent>
      </Collapsible>

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
                <kbd className="ml-2 px-1 py-0.5 text-xs bg-muted/50 rounded">
                  {getPlatformKey()}+ENTER
                </kbd>
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
