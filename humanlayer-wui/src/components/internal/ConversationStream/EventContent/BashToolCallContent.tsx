import { CommandToken } from '../../CommandToken'
import { BashToolCallContentProps } from './types'
import { StatusBadge } from './StatusBadge'
import { getApprovalStatusColor } from './utils/formatters'

export function BashToolCallContent({
  toolInput,
  approvalStatus,

  toolResultContent,
  isFocused,
}: BashToolCallContentProps) {
  const formatToolResult = (content: string) => {
    const lines = content.split('\n').filter(l => l.trim())
    if (lines.length === 0) {
      return null
    } else if (lines.length === 1) {
      return lines[0].length > 80 ? `${lines[0].slice(0, 77)}...` : lines[0]
    } else {
      const firstLine = lines[0]
      return `${firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine} ... (${lines.length} lines)`
    }
  }

  const formattedResult = toolResultContent ? formatToolResult(toolResultContent) : null

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`font-semibold ${getApprovalStatusColor(approvalStatus) || ''}`}>
              Bash
            </span>
            {toolInput.description && (
              <span className="text-sm text-muted-foreground">{toolInput.description}</span>
            )}
          </div>
          <div className="mt-1">
            <CommandToken>{toolInput.command}</CommandToken>
          </div>
        </div>
        <div className="ml-4">
          <StatusBadge status={approvalStatus} />
        </div>
      </div>

      {toolInput.run_in_background && (
        <div className="text-xs text-muted-foreground">Running in background</div>
      )}

      {toolInput.timeout && (
        <div className="text-xs text-muted-foreground">Timeout: {toolInput.timeout}ms</div>
      )}

      {formattedResult && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span>
            {formattedResult}
            {isFocused && (
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
