import React, { useState, useRef, useEffect } from 'react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  isLoading?: boolean
}

export default function CommandInput({
  value,
  onChange,
  onSubmit,
  placeholder = 'Enter your command...',
  isLoading = false,
}: CommandInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={isLoading}
          className={cn(
            'w-full h-12 px-4 py-3 text-base',
            'font-mono leading-relaxed',
            'bg-background border-2 rounded-lg',
            'transition-all duration-200',
            'placeholder:text-muted-foreground/60',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            isFocused
              ? 'border-primary ring-4 ring-primary/20'
              : 'border-border hover:border-primary/50',
          )}
          autoComplete="off"
          spellCheck={false}
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="animate-spin h-4 w-4 border-2 border-primary border-r-transparent rounded-full" />
          </div>
        )}
      </div>

      {value.trim() && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
            {value.startsWith('/') && (
              <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                Working directory mode
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
