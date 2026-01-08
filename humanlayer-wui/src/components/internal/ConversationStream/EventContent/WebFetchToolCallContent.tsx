import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'
import { getApprovalStatusColor, detectToolError, extractMcpError } from './utils/formatters'

interface WebFetchToolInput {
  url: string
  prompt?: string
}

export function WebFetchToolCallContent({
  toolInput,
  approvalStatus,

  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<WebFetchToolInput>) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const formatFetchResult = (content: string): { text: string; isError: boolean; suggestion?: string | null } => {
    // Check for errors FIRST using centralized detection
    if (detectToolError('WebFetch', content)) {
      const mcpError = extractMcpError(content)
      if (mcpError) {
        return {
          text: `Fetch failed: ${mcpError.message}`,
          suggestion: mcpError.suggestion,
          isError: true,
        }
      }
      return { text: 'Fetch failed', isError: true }
    }

    // Try to extract character count or size info
    const charCount = content.length
    if (charCount > 0) {
      const kbSize = (charCount / 1024).toFixed(1)
      return { text: `Fetched ${kbSize}KB of content`, isError: false }
    }
    return { text: 'No content retrieved', isError: false }
  }

  const formattedResult = toolResultContent ? formatFetchResult(toolResultContent) : null

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Web Fetch"
        nameColor={formattedResult?.isError ? undefined : statusColor}
        nameStyle={formattedResult?.isError ? { color: 'var(--terminal-error)' } : undefined}
        primaryParam={
          <div className="flex items-center gap-2">
            <span className="text-sm">
              <a
                href={toolInput.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline hover:text-accent/80 transition-colors"
              >
                {toolInput.url}
              </a>
            </span>
          </div>
        }
        secondaryParam={
          toolInput.prompt ? (
            <div className="text-sm text-muted-foreground italic">&ldquo;{toolInput.prompt}&rdquo;</div>
          ) : undefined
        }
        status={<StatusBadge status={approvalStatus} />}
      />

      {formattedResult && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <div>
            <span className={formattedResult.isError ? 'text-destructive' : ''}>
              {formattedResult.text}
              {isFocused && toolResultContent && toolResultContent.length > 100 && (
                <span className="text-xs text-muted-foreground/50 ml-2">
                  <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
                </span>
              )}
            </span>
            {formattedResult.isError && formattedResult.suggestion && (
              <div className="text-xs text-muted-foreground mt-1">
                {formattedResult.suggestion}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
