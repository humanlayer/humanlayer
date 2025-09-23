import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { formatLineCount, getApprovalStatusColor } from './utils/formatters'
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
  isGroupItem,
}: ToolCallContentProps<ReadToolInput>) {
  const lineCount = toolResultContent ? formatLineCount(toolResultContent, 1) : null // Subtract 1 for system reminder

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Read"
        description={'Read from file'}
        primaryParam={<span className="font-mono text-sm">{toolInput.file_path}</span>}
        status={<StatusBadge status={approvalStatus} />}
        nameColor={statusColor}
      />

      <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
        <span>
          {lineCount ? `Read ${lineCount} ` : ''}
          {isFocused && (
            <>
              <span className="text-muted-foreground/50">⎿</span>
              <span className="text-xs text-muted-foreground/50 ml-2">
                <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
