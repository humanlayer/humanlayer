import React, { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { SearchInput } from './FuzzySearchInput'
import { Input } from './ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'

interface SessionConfig {
  query: string
  workingDir: string
  model?: string
  maxTurns?: number
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
  config = { query: '', workingDir: '' },
  onConfigChange,
}: CommandInputProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const { paths: recentPaths } = useRecentPaths()

  useEffect(() => {
    // focus on the prompt when the component mounts
    if (promptRef.current) {
      promptRef.current.focus()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !showAdvanced) {
      e.preventDefault()
      onSubmit()
    }

    if (e.key === 'Escape') {
      promptRef.current?.blur()
    }
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
          value={config.workingDir}
          onChange={value => onConfigChange?.({ ...config, workingDir: value })}
          onSubmit={onSubmit}
          placeholder="/path/to/directory or leave empty for current directory"
          recentDirectories={recentPaths}
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
          onKeyDown={handleKeyDown}
          // onFocus={() => setIsFocused(true)}
          // onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-r-transparent rounded-full" />
          </div>
        )}
      </div>

      {/* Advanced Options Toggle */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAdvanced ? '← Hide' : 'Advanced Options →'}
        </button>
      </div>

      {/* Advanced Options */}
      {showAdvanced && (
        <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Model</label>
              <Select
                value={config.model || ''}
                onValueChange={value => updateConfig({ model: value || undefined })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Sonnet</SelectItem>
                  <SelectItem value="opus">Opus</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Max Turns</label>
              <Input
                type="number"
                value={config.maxTurns || ''}
                onChange={e =>
                  updateConfig({ maxTurns: e.target.value ? parseInt(e.target.value) : undefined })
                }
                placeholder="Default"
                min="1"
                max="100"
                className={cn(
                  'w-full h-9 px-3 text-sm',
                  'bg-background border rounded-md',
                  'border-border hover:border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20',
                )}
              />
            </div>
          </div>
        </div>
      )}

      {/* Action Bar */}
      {value.trim() && (
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            {config.workingDir && (
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded font-mono text-xs">
                {config.workingDir}
              </span>
            )}
          </div>

          <Button
            onClick={onSubmit}
            disabled={!value.trim() || isLoading}
            size="sm"
            className="font-mono"
          >
            {isLoading ? (
              <>
                <div className="animate-spin h-3 w-3 border border-current border-r-transparent rounded-full mr-2" />
                Launching...
              </>
            ) : (
              'Launch Session'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
