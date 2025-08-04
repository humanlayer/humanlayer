import React, { useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { SearchInput } from './FuzzySearchInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { Textarea } from './ui/textarea'
import { Label } from './ui/label'
import { hasContent, isEmptyOrWhitespace } from '@/utils/validation'

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
  const directoryRef = useRef<HTMLInputElement>(null)
  const { paths: recentPaths } = useRecentPaths()

  useEffect(() => {
    // Focus on directory input if it's empty or default (~/)
    // Focus on prompt if directory has a user-provided value
    if (config.workingDir === '' || config.workingDir === '~/') {
      if (directoryRef.current) {
        directoryRef.current.focus()
      }
    } else {
      if (promptRef.current) {
        promptRef.current.focus()
      }
    }
  }, [config.workingDir])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit()
    }

    if (e.key === 'Escape') {
      promptRef.current?.blur()
    }
  }

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

      {/* Main query input */}
      <div className="relative space-y-2">
        <Label htmlFor="prompt">Prompt</Label>
        <Textarea
          id="prompt"
          ref={promptRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isLoading}
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground mt-1">
          <kbd className="px-1 py-0.5 bg-muted/50 rounded">{getPlatformKey()}+Enter</kbd> to launch
          session, <kbd className="ml-1 px-1 py-0.5 bg-muted/50 rounded">Enter</kbd> for new line
        </p>

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-r-transparent rounded-full" />
          </div>
        )}
      </div>

      {/* Model Selection */}
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
              'Launch Session'
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
