import { useState, useEffect } from 'react'
import { GitBranch, AlertCircle, CheckCircle, Pencil, Eye, EyeOff } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { daemonClient } from '@/lib/daemon'
import { Session, ConfigStatus } from '@/lib/daemon/types'
import { toast } from 'sonner'
import { useStore } from '@/AppStore'

interface ModelSelectorProps {
  session: Session
  onModelChange?: (model: string) => void
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function ModelSelectorContent({
  session,
  onModelChange,
  onClose,
}: Omit<ModelSelectorProps, 'className'> & { onClose: () => void }) {
  const fetchActiveSessionDetail = useStore(state => state.fetchActiveSessionDetail)
  const userSettings = useStore(state => state.userSettings)

  const isAdvancedProvidersEnabled = userSettings?.advancedProviders ?? false

  // Parse provider and model from current session
  const getProviderAndModel = () => {
    // Check if session has an explicit provider field (new approach)
    if ((session as any).provider) {
      return {
        provider: (session as any).provider as 'anthropic' | 'openrouter' | 'baseten' | 'z_ai',
        model: session.proxyModelOverride || session.model || 'default',
      }
    }

    // Fallback: infer from proxy settings (legacy approach)
    if (session.proxyEnabled && session.proxyModelOverride) {
      // Determine provider based on proxy base URL
      if (session.proxyBaseUrl && session.proxyBaseUrl.includes('baseten.co')) {
        return {
          provider: 'baseten' as const,
          model: session.proxyModelOverride,
        }
      } else if (session.proxyBaseUrl && session.proxyBaseUrl.includes('z-ai.ai')) {
        return {
          provider: 'z_ai' as const,
          model: session.proxyModelOverride,
        }
      } else {
        return {
          provider: 'openrouter' as const,
          model: session.proxyModelOverride,
        }
      }
    }

    // Otherwise using Anthropic
    return {
      provider: 'anthropic' as const,
      model: session.model || 'default',
    }
  }

  const initial = getProviderAndModel()
  const [provider, setProvider] = useState<'anthropic' | 'openrouter' | 'baseten' | 'z_ai'>(
    initial.provider as any,
  )
  const [model, setModel] = useState(
    initial.provider === 'anthropic' ? initial.model || 'default' : 'default',
  )
  const [customModel, setCustomModel] = useState(initial.provider === 'openrouter' ? initial.model : '')
  const [isUpdating, setIsUpdating] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [isCheckingConfig, setIsCheckingConfig] = useState(false)
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [apiKey, setApiKey] = useState(() => {
    // Load saved API key from localStorage based on initial provider
    if (initial.provider === 'baseten') {
      return localStorage.getItem('humanlayer-baseten-api-key') || ''
    } else if (initial.provider === 'z_ai') {
      return localStorage.getItem('humanlayer-z-ai-api-key') || ''
    }
    return localStorage.getItem('humanlayer-openrouter-api-key') || ''
  })
  const [showPassword, setShowPassword] = useState(false)

  // Update local state when session changes
  useEffect(() => {
    const current = getProviderAndModel()
    setProvider(current.provider)
    if (current.provider === 'anthropic') {
      setModel(current.model || 'default')
      setCustomModel('')
    } else {
      setModel('default')
      setCustomModel(current.model)
    }

    // Update API key when provider changes
    if (current.provider === 'baseten') {
      setApiKey(localStorage.getItem('humanlayer-baseten-api-key') || '')
    } else if (current.provider === 'openrouter') {
      setApiKey(localStorage.getItem('humanlayer-openrouter-api-key') || '')
    } else if (current.provider === 'z_ai') {
      setApiKey(localStorage.getItem('humanlayer-z-ai-api-key') || '')
    }
  }, [session.model, session.proxyEnabled, session.proxyModelOverride, session.proxyBaseUrl])

  // Check config status when provider changes to OpenRouter, Baseten, or Z-AI
  useEffect(() => {
    if (provider === 'openrouter' || provider === 'baseten' || provider === 'z_ai') {
      setIsCheckingConfig(true)
      daemonClient
        .getConfigStatus()
        .then(setConfigStatus)
        .catch(err => {
          console.error('Failed to check config:', err)
          toast.error('Failed to check configuration')
        })
        .finally(() => setIsCheckingConfig(false))
    }
  }, [provider])

  const handleProviderChange = (newProvider: 'anthropic' | 'openrouter' | 'baseten' | 'z_ai') => {
    setProvider(newProvider)
    setHasChanges(true)

    // Clear model when switching providers
    if (newProvider === 'anthropic') {
      setModel('default')
      setCustomModel('')
    } else {
      setCustomModel('')
      setModel('default')
    }

    // Update API key when switching providers
    if (newProvider === 'baseten') {
      setApiKey(localStorage.getItem('humanlayer-baseten-api-key') || '')
    } else if (newProvider === 'openrouter') {
      setApiKey(localStorage.getItem('humanlayer-openrouter-api-key') || '')
    } else if (newProvider === 'z_ai') {
      setApiKey(localStorage.getItem('humanlayer-z-ai-api-key') || '')
    } else {
      setApiKey('')
    }
  }

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    setHasChanges(true)
  }

  const handleCustomModelChange = (value: string) => {
    setCustomModel(value)
    setHasChanges(true)
  }

  const canApplyOpenRouter =
    provider !== 'openrouter' ||
    (configStatus?.openrouter?.api_key_configured ?? false) ||
    apiKey.length > 0

  const canApplyBaseten =
    provider !== 'baseten' || (configStatus?.baseten?.api_key_configured ?? false) || apiKey.length > 0

  const canApplyZAI =
    provider !== 'z_ai' || (configStatus?.z_ai?.api_key_configured ?? false) || apiKey.length > 0

  const handleApply = async () => {
    if ((provider === 'openrouter' || provider === 'baseten') && !customModel.trim()) {
      const providerName = provider === 'baseten' ? 'Baseten' : 'OpenRouter'
      toast.error(`Model name is required for ${providerName}`)
      return
    }

    if (provider === 'z_ai' && !customModel) {
      toast.error('Please select a Z-AI model')
      return
    }

    if (!canApplyOpenRouter) {
      toast.error('OpenRouter API key is required')
      return
    }

    if (!canApplyBaseten) {
      toast.error('Baseten API key is required')
      return
    }

    if (provider === 'z_ai' && !canApplyZAI) {
      toast.error('Z-AI API key is required')
      return
    }

    setIsUpdating(true)
    try {
      // Build update request with provider
      const updateRequest: any = {
        provider, // Send provider explicitly
      }

      if (provider === 'anthropic') {
        // For Anthropic, just set the model
        updateRequest.model = model === 'default' ? '' : model
        // Clear proxy settings
        updateRequest.proxyEnabled = false
        updateRequest.proxyModelOverride = undefined
        updateRequest.proxyApiKey = undefined
      } else {
        // For non-Anthropic providers, set proxy configuration
        updateRequest.model = undefined // Clear Anthropic model
        updateRequest.proxyEnabled = true
        updateRequest.proxyModelOverride = customModel || ''
        updateRequest.proxyApiKey = apiKey || undefined

        // The backend will determine the base URL based on the provider
        // No need to send proxyBaseUrl anymore
      }

      // Update session with provider and configuration
      await daemonClient.updateSession(session.id, updateRequest)

      // Save API key to localStorage if provided
      if (apiKey && provider === 'openrouter') {
        localStorage.setItem('humanlayer-openrouter-api-key', apiKey)
      } else if (apiKey && provider === 'baseten') {
        localStorage.setItem('humanlayer-baseten-api-key', apiKey)
      } else if (apiKey && provider === 'z_ai') {
        localStorage.setItem('humanlayer-z-ai-api-key', apiKey)
      }

      // Notify parent component
      if (onModelChange) {
        const modelToReport = provider === 'anthropic' ? (model === 'default' ? '' : model) : ''
        onModelChange(modelToReport)
      }

      // Show appropriate message based on session status
      if (session.status === 'running' || session.status === 'starting') {
        toast.success('Model change will apply at next message')
      } else {
        toast.success('Model updated')
      }

      setHasChanges(false)
      setShowApiKeyInput(false)
      // Don't clear the API key from state - keep it for display
      // setApiKey('') // Clear API key from state after saving

      // Refresh the session data to update the status bar
      await fetchActiveSessionDetail(session.id)

      // Close modal immediately after successful update
      onClose()
    } catch (error) {
      console.error('Failed to update model:', error)
      toast.error('Failed to update model')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Model Configuration</DialogTitle>
        {isAdvancedProvidersEnabled && (
          <DialogDescription>
            Configure the model provider and specific model for this session
          </DialogDescription>
        )}
      </DialogHeader>

      <div className="mt-6 space-y-4">
        {/* Provider Selection */}
        {isAdvancedProvidersEnabled && (
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={provider}
              onValueChange={value =>
                handleProviderChange(value as 'anthropic' | 'openrouter' | 'baseten' | 'z_ai')
              }
              disabled={isUpdating}
            >
              <SelectTrigger id="provider" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="baseten">Baseten</SelectItem>
                <SelectItem value="z_ai">Z-AI</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Model Selection */}
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          {provider === 'openrouter' ? (
            <Input
              id="model"
              type="text"
              value={customModel}
              onChange={e => handleCustomModelChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleApply()
                }
              }}
              placeholder="e.g., openai/gpt-oss-120b"
              disabled={isUpdating}
              className="w-full"
            />
          ) : provider === 'z_ai' ? (
            <Select
              value={customModel || ''}
              onValueChange={handleCustomModelChange}
              disabled={isUpdating}
            >
              <SelectTrigger id="model" className="w-full">
                <SelectValue placeholder="Select Z-AI Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="glm-4.5">GLM-4.5</SelectItem>
                <SelectItem value="glm-4.5-air">GLM-4.5-Air</SelectItem>
              </SelectContent>
            </Select>
          ) : provider === 'baseten' ? (
            <Input
              id="model"
              type="text"
              value={customModel}
              onChange={e => handleCustomModelChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleApply()
                }
              }}
              placeholder="e.g., deepseek-ai/DeepSeek-V3.1"
              disabled={isUpdating}
              className="w-full"
            />
          ) : (
            <Select value={model || 'default'} onValueChange={handleModelChange} disabled={isUpdating}>
              <SelectTrigger id="model" className="w-full">
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">System Default</SelectItem>
                <SelectItem value="sonnet">Sonnet</SelectItem>
                <SelectItem value="opus">Opus</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        {/* Help Text */}
        {provider === 'anthropic' && isAdvancedProvidersEnabled && (
          <div className="text-muted-foreground">
            <p>Select a model or use the system default</p>
          </div>
        )}

        {/* API Key Status for OpenRouter, Baseten, and Z-AI */}
        {(provider === 'openrouter' || provider === 'baseten' || provider === 'z_ai') && (
          <div className="space-y-2">
            {!showApiKeyInput ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {isCheckingConfig ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                      provider === 'openrouter'
                        ? canApplyOpenRouter
                        : provider === 'baseten'
                          ? canApplyBaseten
                          : canApplyZAI
                    ) ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-destructive" />
                  )}
                  <span
                    className={
                      (
                        provider === 'openrouter'
                          ? canApplyOpenRouter
                          : provider === 'baseten'
                            ? canApplyBaseten
                            : canApplyZAI
                      )
                        ? 'text-muted-foreground'
                        : 'text-destructive'
                    }
                  >
                    {isCheckingConfig
                      ? `Checking ${provider === 'baseten' ? 'Baseten' : provider === 'z_ai' ? 'Z-AI' : 'OpenRouter'} configuration...`
                      : (
                            provider === 'openrouter'
                              ? canApplyOpenRouter
                              : provider === 'baseten'
                                ? canApplyBaseten
                                : canApplyZAI
                          )
                        ? `${provider === 'baseten' ? 'Baseten' : provider === 'z_ai' ? 'Z-AI' : 'OpenRouter'} API key is configured`
                        : `${provider === 'baseten' ? 'Baseten' : provider === 'z_ai' ? 'Z-AI' : 'OpenRouter'} API key required`}
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
                <Label htmlFor="api-key">
                  {provider === 'baseten' ? 'Baseten' : provider === 'z_ai' ? 'Z-AI' : 'OpenRouter'} API
                  Key
                </Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id="api-key"
                      type={showPassword ? 'text' : 'password'}
                      value={apiKey}
                      onChange={e => {
                        setApiKey(e.target.value)
                        setHasChanges(true)
                      }}
                      placeholder={
                        provider === 'baseten'
                          ? 'Enter Baseten API key...'
                          : provider === 'z_ai'
                            ? 'Enter Z-AI API key...'
                            : 'sk-or-...'
                      }
                      className="h-8 pr-10"
                    />
                    {apiKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-8 w-8 p-0"
                        onClick={() => setShowPassword(!showPassword)}
                        type="button"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    )}
                  </div>
                  {apiKey ? (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 px-3"
                      onClick={() => {
                        setShowApiKeyInput(false)
                        setShowPassword(false)
                        // API key will be saved when Apply is clicked
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
                        setApiKey('')
                        setShowPassword(false)
                      }}
                      type="button"
                    >
                      Cancel
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground">Your API key will be stored with this session</p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <Button onClick={onClose} disabled={isUpdating} variant="outline" size="sm">
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={
              !hasChanges ||
              isUpdating ||
              (provider === 'openrouter' && !canApplyOpenRouter) ||
              (provider === 'baseten' && !canApplyBaseten) ||
              (provider === 'z_ai' && !canApplyZAI) ||
              ((provider === 'openrouter' || provider === 'baseten') && !customModel.trim()) ||
              (provider === 'z_ai' && !customModel)
            }
            size="sm"
          >
            {isUpdating ? 'Applying...' : 'Apply'}
          </Button>
        </div>
      </div>
    </>
  )
}

// Main component that handles the dialog
export function ModelSelector({
  session,
  onModelChange,
  className,
  open,
  onOpenChange,
}: ModelSelectorProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const setIsOpen = onOpenChange ?? setInternalOpen

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {/* Only show trigger if not controlled externally */}
      {!open && !onOpenChange && (
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 p-0 ${className}`}
            title="Model Configuration"
          >
            <GitBranch className="h-4 w-4" />
          </Button>
        </DialogTrigger>
      )}

      <DialogContent
        className="max-w-md"
        onInteractOutside={e => {
          // Prevent closing when clicking outside if there are unsaved changes
          e.preventDefault()
        }}
        onEscapeKeyDown={e => {
          // Let the dialog handle escape
          e.stopPropagation()
        }}
      >
        {isOpen && (
          <ModelSelectorContent
            session={session}
            onModelChange={onModelChange}
            onClose={() => setIsOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
