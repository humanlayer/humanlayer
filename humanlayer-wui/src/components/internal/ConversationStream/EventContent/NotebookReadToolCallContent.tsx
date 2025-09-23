import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import {
  formatToolResultPreview,
  detectToolError,
  getApprovalStatusColor,
  formatLineCount,
} from './utils/formatters'
import { ToolCallContentProps } from './types'
import { ApprovalStatus } from '@humanlayer/hld-sdk'

export interface NotebookReadToolInput {
  notebook_path: string
  cell_id?: string
}

export function NotebookReadToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<NotebookReadToolInput>) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const isDenied = approvalStatus === ApprovalStatus.Denied
  const hasError = toolResultContent ? detectToolError('NotebookRead', toolResultContent) : false
  let preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null

  if (isDenied) {
    preview = `Denial Reason: ${toolResultContent ? formatToolResultPreview(toolResultContent) : null}`
  }

  const lineCount = toolResultContent ? formatLineCount(toolResultContent) : null

  return (
    <div className="space-y-2">
      <ToolHeader
        name="NotebookRead"
        description={toolInput.cell_id ? `Cell: ${toolInput.cell_id}` : undefined}
        primaryParam={<span className="font-mono text-sm">{toolInput.notebook_path}</span>}
        nameColor={statusColor}
        status={<StatusBadge status={approvalStatus} />}
      />

      {isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError ? (
              preview || 'Error reading notebook'
            ) : (
              <>
                {lineCount && !toolInput.cell_id && `${lineCount} cells read`}
                {toolInput.cell_id && `Cell content retrieved`}
                {!lineCount && !toolInput.cell_id && 'Notebook read successfully'}
              </>
            )}
            {isFocused && !hasError && (
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
