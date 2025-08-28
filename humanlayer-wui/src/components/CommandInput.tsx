import React, { useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { SearchInput } from './FuzzySearchInput'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { Textarea } from './ui/textarea'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { hasContent, isEmptyOrWhitespace } from '@/utils/validation'
import { DataTransformErrorBoundary } from '@/components/ui/DataTransformErrorBoundary'
import { BaseErrorBoundary } from '@/components/ui/BaseErrorBoundary'

interface SessionConfig {
  title?: string
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
  config = { workingDir: '' },
  onConfigChange,
}: CommandInputProps) {
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const directoryRef = useRef<HTMLInputElement>(null)
  const { paths: recentPaths } = useRecentPaths()

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
    <DataTransformErrorBoundary
      dataContext="command input form data"
      expectedDataType="SessionConfig"
      contextInfo={{ config, value, isLoading }}
      critical={true}
      fallbackData={{ workingDir: '' }}
    >
      <div className="space-y-4">
        {/* Working Directory Field with Fuzzy Search */}
        <div className="space-y-2">
          <Label>Working Directory</Label>
          <BaseErrorBoundary
            title="Directory search failed"
            description="Failed to load recent paths or search directories"
            contextInfo={{ recentPathsCount: recentPaths?.length || 0, workingDir: config.workingDir }}
          >
            <SearchInput
              ref={directoryRef}
              value={config.workingDir}
              onChange={value => onConfigChange?.({ ...config, workingDir: value })}
              onSubmit={onSubmit}
              placeholder="/path/to/directory or leave empty for current directory"
              recentDirectories={recentPaths}
            />
          </BaseErrorBoundary>
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
    </DataTransformErrorBoundary>
  )
}
