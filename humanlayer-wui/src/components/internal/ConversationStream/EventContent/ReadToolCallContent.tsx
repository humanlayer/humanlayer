import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { formatLineCount, formatToolResultPreview, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'

export interface ReadToolInput {
  file_path: string
  limit?: number
  offset?: number
}

export function ReadToolCallContent({
  toolInput,
  approvalStatus,

  toolResultContent,
  isFocused,
}: ToolCallContentProps<ReadToolInput>) {
  const lineCount = toolResultContent ? formatLineCount(toolResultContent, 1) : null // Subtract 1 for system reminder
  const preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Read"
        description={
          toolInput.offset || toolInput.limit
            ? `${toolInput.offset ? `from line ${toolInput.offset}` : ''}${
                toolInput.limit ? ` (${toolInput.limit} lines max)` : ''
              }`
            : undefined
        }
        primaryParam={<span className="font-mono text-sm">{toolInput.file_path}</span>}
        status={<StatusBadge status={approvalStatus} />}
        nameColor={getApprovalStatusColor(approvalStatus)}
      />

      {preview && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span>
            {lineCount ? `${lineCount}: ` : ''}
            {preview}
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
