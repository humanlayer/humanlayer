import { forwardRef, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { Input } from './ui/input'

interface CommandInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  isLoading?: boolean
  disabled?: boolean
}

export const CommandInput = forwardRef<HTMLInputElement, CommandInputProps>(
  ({ value, onChange, onSubmit, placeholder, isLoading = false, disabled = false }, ref) => {
    const internalRef = useRef<HTMLInputElement>(null)
    const inputRef = ref || internalRef

    // Auto-focus when component mounts
    useEffect(() => {
      if (inputRef && 'current' in inputRef && inputRef.current) {
        inputRef.current.focus()
      }
    }, [inputRef])

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onSubmit()
      }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value)
    }

    const characterCount = value.length

    return (
      <div className="space-y-3">
        <div className="relative">
          <Input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder || 'Enter your query (e.g. "debug login component", "/src fix auth flow")'}
            disabled={disabled || isLoading}
            className={cn(
              // Large input styling
              'h-12 text-lg px-4 py-3',
              // Monospace font for code-like appearance
              'font-mono',
              // High contrast styling
              'bg-background border-2 border-border',
              // Focus styling that matches existing patterns
              'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-4',
              // Disabled state
              isLoading && 'opacity-60',
              // Enhanced styling for the launcher
              'transition-all duration-200'
            )}
            autoComplete="off"
            spellCheck={false}
          />
          
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="animate-spin h-5 w-5 border-2 border-muted border-t-foreground rounded-full" />
            </div>
          )}
        </div>
        
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="font-mono">
            {characterCount} characters
          </div>
          <div className="space-x-4">
            <span className="font-mono">↵ Launch</span>
            <span className="font-mono">⌘K Close</span>
          </div>
        </div>
      </div>
    )
  }
)

CommandInput.displayName = 'CommandInput'