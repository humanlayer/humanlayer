import { useState, useEffect } from 'react'
import { GitBranch, AlertCircle, CheckCircle } from 'lucide-react'
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
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  // Parse provider and model from current session
  const getProviderAndModel = (model?: string) => {
    if (!model || model === '') return { provider: 'anthropic' as const, model: 'default' }
    
    // Check if it's an OpenRouter model (contains /)
    if (model.includes('/')) {
      return { provider: 'openrouter' as const, model }
    }
    
    // Otherwise it's an Anthropic model (sonnet, opus, or 'default' for empty)
    return { provider: 'anthropic' as const, model }
  }

  const initial = getProviderAndModel(session.model)
  const [provider, setProvider] = useState<'anthropic' | 'openrouter'>(initial.provider)
  const [model, setModel] = useState(initial.model || 'default')
  const [customModel, setCustomModel] = useState(initial.provider === 'openrouter' ? initial.model : '')
  const [isUpdating, setIsUpdating] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [isCheckingConfig, setIsCheckingConfig] = useState(false)

  // Update local state when session changes
  useEffect(() => {
    const current = getProviderAndModel(session.model)
    setProvider(current.provider)
    setModel(current.model || 'default')
    if (current.provider === 'openrouter') {
      setCustomModel(current.model)
    }
  }, [session.model])

  // Check config status when provider changes to OpenRouter
  useEffect(() => {
    if (provider === 'openrouter') {
      setIsCheckingConfig(true)
      daemonClient.getConfigStatus()
        .then(setConfigStatus)
        .catch(err => {
          console.error('Failed to check config:', err)
          toast.error('Failed to check configuration')
        })
        .finally(() => setIsCheckingConfig(false))
    }
  }, [provider])

  const handleProviderChange = (newProvider: 'anthropic' | 'openrouter') => {
    setProvider(newProvider)
    setHasChanges(true)
    
    // Clear model when switching providers
    if (newProvider === 'anthropic') {
      setModel('default')
    } else {
      setCustomModel('')
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

  const canApplyOpenRouter = provider !== 'openrouter' || 
    (configStatus?.openrouter?.api_key_configured ?? false)

  const handleApply = async () => {
    if (!canApplyOpenRouter) {
      toast.error('OpenRouter API key is required')
      return
    }
    
    let modelValue = ''
    
    if (provider === 'anthropic') {
      modelValue = model === 'default' ? '' : model
    } else if (provider === 'openrouter') {
      modelValue = customModel // Can be empty string, which is valid
    }
    
    await updateSessionModel(modelValue)
  }

  const updateSessionModel = async (modelValue: string) => {
    setIsUpdating(true)
    try {
      // Update the session model using the daemon client
      await daemonClient.updateSession(session.id, {
        model: modelValue || undefined,
      })
      
      // Notify parent component
      if (onModelChange) {
        onModelChange(modelValue)
      }
      
      toast.success('Model updated')
      setHasChanges(false)
      
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
        <DialogDescription>
          Configure the model provider and specific model for this session
        </DialogDescription>
      </DialogHeader>

      <div className="mt-6 space-y-4">
        {/* Provider Selection */}
        <div className="space-y-2">
          <Label htmlFor="provider">Provider</Label>
          <Select
            value={provider}
            onValueChange={value => handleProviderChange(value as 'anthropic' | 'openrouter')}
            disabled={isUpdating}
          >
            <SelectTrigger id="provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
            </SelectContent>
          </Select>
        </div>

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
              placeholder="e.g., anthropic/claude-3-opus"
              disabled={isUpdating}
              className="w-full"
            />
          ) : (
            <Select
              value={model || 'default'}
              onValueChange={handleModelChange}
              disabled={isUpdating}
            >
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
        <div className="text-xs text-muted-foreground">
          {provider === 'openrouter' ? (
            <p>Enter the full model identifier from OpenRouter (e.g., "anthropic/claude-3-opus")</p>
          ) : (
            <p>Select a model or use the system default</p>
          )}
        </div>

        {/* OpenRouter API Key Status */}
        {provider === 'openrouter' && (
          <Alert variant={canApplyOpenRouter ? 'default' : 'destructive'}>
            <div className="flex items-center gap-2">
              {isCheckingConfig ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : canApplyOpenRouter ? (
                <CheckCircle className="h-4 w-4" />
              ) : (
                <AlertCircle className="h-4 w-4" />
              )}
              <AlertDescription>
                {isCheckingConfig ? (
                  'Checking OpenRouter configuration...'
                ) : canApplyOpenRouter ? (
                  'OpenRouter API key is configured'
                ) : (
                  'OpenRouter API key is not configured. Set OPENROUTER_API_KEY environment variable.'
                )}
              </AlertDescription>
            </div>
          </Alert>
        )}
        
        {/* Model change notice */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Model changes will take effect on your next message. 
            {(session.status === 'running' || session.status === 'starting') && (
              ' Use "Interrupt & Send" to apply changes immediately.'
            )}
          </AlertDescription>
        </Alert>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-2">
          <Button
            onClick={onClose}
            disabled={isUpdating}
            variant="outline"
            size="sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={!hasChanges || isUpdating || !canApplyOpenRouter}
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
export function ModelSelector({ session, onModelChange, className, open, onOpenChange }: ModelSelectorProps) {
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