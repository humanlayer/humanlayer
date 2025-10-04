import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'
import { getApprovalStatusColor } from './utils/formatters'

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

  const formatFetchResult = (content: string) => {
    // Try to extract character count or size info
    const charCount = content.length
    if (charCount > 0) {
      const kbSize = (charCount / 1024).toFixed(1)
      return `Fetched ${kbSize}KB of content`
    }
    return 'No content retrieved'
  }

  const formattedResult = toolResultContent ? formatFetchResult(toolResultContent) : null

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Web Fetch"
        nameColor={statusColor}
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
          <span>
            {formattedResult}
            {isFocused && toolResultContent && toolResultContent.length > 100 && (
              <span className="text-xs text-muted-foreground/50 ml-2">
                <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
