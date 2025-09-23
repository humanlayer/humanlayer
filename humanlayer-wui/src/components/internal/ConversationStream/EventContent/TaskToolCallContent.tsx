import { ChevronRight } from 'lucide-react'
import { ToolCallContentProps } from './types'
import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { formatToolResultPreview, getApprovalStatusColor } from './utils/formatters'

interface TaskToolInput {
  description: string
  prompt: string
  subagent_type: string
}

export function TaskToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<TaskToolInput>) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const getResultPreview = () => {
    if (!toolResultContent) return null

    // Task results are often long, show first line as preview
    const firstLine = toolResultContent.split('\n')[0]
    return formatToolResultPreview(firstLine, { truncateLength: 80 })
  }

  const resultPreview = getResultPreview()

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start justify-between w-full">
        <ToolHeader
          name={toolInput.subagent_type || 'Task'}
          description={toolInput.description}
          nameColor={statusColor}
        />
        <div className="ml-4">
          <StatusBadge status={approvalStatus} />
        </div>
      </div>

      {!isCompleted && (
        <div className="text-xs text-muted-foreground ml-4">
          <ChevronRight className="inline-block w-3 h-3 mr-1" />
          <span className="italic">{toolInput.prompt.substring(0, 100)}...</span>
        </div>
      )}

      {resultPreview && <div className="text-xs text-muted-foreground ml-4 mt-1">{resultPreview}</div>}

      {isFocused && isCompleted && toolResultContent && (
        <div className="text-xs text-muted-foreground/60 ml-4">Press Enter to view full result</div>
      )}
    </div>
  )
}
