interface UnknownToolCallContentProps {
  toolName?: string
  toolInput?: any
  isCompleted?: boolean
  toolResultContent?: string
  isFocused?: boolean
  isGroupItem?: boolean
}

/**
 * Fallback component for unmigrated or unknown tools.
 * Provides a generic display for tools that don't have a specific component yet.
 */
export function UnknownToolCallContent({
  toolName,
  toolInput,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem = false,
}: UnknownToolCallContentProps) {
  // Log warning for unmigrated tools in development
  if (import.meta.env.DEV) {
    console.warn(`Unmigrated tool: ${toolName}`)
  }

  // Format the tool input for display
  const formatToolInput = () => {
    if (!toolInput) return 'No input'
    try {
      // Try to show first few key-value pairs
      const entries = Object.entries(toolInput).slice(0, 2)
      return entries
        .map(([key, value]) => {
          const displayValue =
            typeof value === 'string' && value.length > 50
              ? `${value.substring(0, 50)}...`
              : JSON.stringify(value)
          return `${key}: ${displayValue}`
        })
        .join(', ')
    } catch {
      return 'Complex input'
    }
  }

  return (
    <div className={`overflow-hidden ${isGroupItem ? 'text-xs' : 'text-sm'}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-muted-foreground">{toolName || 'Unknown Tool'}</span>
          <span className="text-muted-foreground/60 text-xs">{formatToolInput()}</span>
        </div>

        {isCompleted && toolResultContent && !isGroupItem && (
          <div className="text-xs text-muted-foreground/60 truncate">
            {toolResultContent.length > 100
              ? `${toolResultContent.substring(0, 100)}...`
              : toolResultContent}
          </div>
        )}

        {isFocused && !isGroupItem && (
          <span className="text-xs text-muted-foreground italic">Press Enter to expand</span>
        )}
      </div>
    </div>
  )
}
