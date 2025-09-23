import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'
import { getApprovalStatusColor } from './utils/formatters'

interface WebSearchToolInput {
  query: string
  allowed_domains?: string[]
  blocked_domains?: string[]
}

export function WebSearchToolCallContent({
  toolInput,
  approvalStatus,

  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<WebSearchToolInput>) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const formatSearchResult = (content: string) => {
    const lines = content.split('\n').filter(l => l.trim())

    // Try to extract result count from the response
    const countMatch = content.match(/(\d+)\s+result/i)
    if (countMatch) {
      return `Found ${countMatch[1]} result${countMatch[1] !== '1' ? 's' : ''}`
    }

    // Fallback to generic response length indicator
    if (lines.length === 0) {
      return 'No results found'
    }

    return `Retrieved search results`
  }

  const formattedResult = toolResultContent ? formatSearchResult(toolResultContent) : null

  // Build domain filter descriptions
  const filterDescriptions = []
  if (toolInput.allowed_domains && toolInput.allowed_domains.length > 0) {
    const domainList = toolInput.allowed_domains.slice(0, 2).join(', ')
    const more =
      toolInput.allowed_domains.length > 2 ? `, +${toolInput.allowed_domains.length - 2} more` : ''
    filterDescriptions.push(`from ${domainList}${more}`)
  }
  if (toolInput.blocked_domains && toolInput.blocked_domains.length > 0) {
    const domainList = toolInput.blocked_domains.slice(0, 2).join(', ')
    const more =
      toolInput.blocked_domains.length > 2 ? `, +${toolInput.blocked_domains.length - 2} more` : ''
    filterDescriptions.push(`excluding ${domainList}${more}`)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`font-semibold ${statusColor || ''}`}>
              Web Search
            </span>
          </div>
          <div className="mt-1">
            <span className="italic text-muted-foreground">{toolInput.query}</span>
          </div>
          {filterDescriptions.length > 0 && (
            <div className="text-xs text-muted-foreground mt-1">{filterDescriptions.join(', ')}</div>
          )}
        </div>
        <div className="ml-4">
          <StatusBadge status={approvalStatus} />
        </div>
      </div>

      {formattedResult && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span>
            {formattedResult}
            {isFocused && toolResultContent && toolResultContent.split('\n').length > 1 && (
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
