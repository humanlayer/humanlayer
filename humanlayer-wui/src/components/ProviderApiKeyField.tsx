import React, { useState } from 'react'
import { AlertCircle, CheckCircle, Eye, EyeOff, Pencil } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'

interface ProviderApiKeyFieldProps {
  provider: string
  displayName: string
  apiKey: string | undefined
  isConfigured: boolean | undefined
  isCheckingConfig: boolean
  placeholder?: string
  onApiKeyChange: (value: string | undefined) => void
}

export function ProviderApiKeyField({
  provider,
  displayName,
  apiKey,
  isConfigured,
  isCheckingConfig,
  placeholder = '',
  onApiKeyChange,
}: ProviderApiKeyFieldProps) {
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const hasApiKey = isConfigured || !!apiKey
  const statusText = isCheckingConfig
    ? `Checking ${displayName} configuration...`
    : hasApiKey
      ? `${displayName} API key is configured`
      : `${displayName} API key required`

  const statusColor = hasApiKey ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'

  return (
    <div className="space-y-2">
      {!showApiKeyInput ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isCheckingConfig ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : hasApiKey ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <span className={statusColor}>{statusText}</span>
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
          <Label htmlFor={`${provider}-api-key`} className="text-xs">
            {displayName} API Key
          </Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={`${provider}-api-key`}
                type={showApiKey ? 'text' : 'password'}
                value={apiKey || ''}
                onChange={e => onApiKeyChange(e.target.value)}
                placeholder={placeholder}
                className="h-8 pr-10 text-sm"
              />
              {apiKey && (
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
            {apiKey ? (
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
                  onApiKeyChange(undefined)
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
  )
}

