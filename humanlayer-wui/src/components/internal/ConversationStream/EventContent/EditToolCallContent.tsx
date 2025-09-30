import { useState } from 'react'
import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { DiffViewer } from './DiffViewer/DiffViewer'
import { DiffViewToggle } from './DiffViewToggle'
import { formatToolResultPreview, detectToolError, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'
import { ApprovalStatus } from '@humanlayer/hld-sdk'

export interface EditToolInput {
  file_path: string
  old_string: string
  new_string: string
  replace_all?: boolean
}

export function EditToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<EditToolInput>) {
  const [isSplitView, setIsSplitView] = useState(false)
  const isDenied = approvalStatus === ApprovalStatus.Denied
  const hasError = toolResultContent ? detectToolError('Edit', toolResultContent) : false
  let preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null
  const showDiff = approvalStatus === 'pending' || approvalStatus === undefined || !isCompleted

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  if (isDenied) {
    preview = `Denial Reason: ${toolResultContent ? formatToolResultPreview(toolResultContent) : null}`
  }

  const toggleView = () => setIsSplitView(!isSplitView)

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Edit"
        description={toolInput.replace_all ? 'Replace all occurrences' : undefined}
        primaryParam={<span className="font-mono text-sm">{toolInput.file_path}</span>}
        nameColor={statusColor}
        status={
          <div className="flex items-center gap-2">
            <StatusBadge status={approvalStatus} />
            {showDiff && <DiffViewToggle isSplitView={isSplitView} onToggle={toggleView} />}
          </div>
        }
      />

      <div className="mt-2">
        <DiffViewer
          oldContent={toolInput.old_string || ''}
          newContent={toolInput.new_string || ''}
          mode={isSplitView ? 'split' : 'unified'}
          showFullFile={false}
        />
      </div>

      {!showDiff && isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError ? preview || 'Error editing file' : 'File updated successfully'}
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
