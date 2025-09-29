import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { DiffViewer } from './DiffViewer/DiffViewer'
import { formatToolResultPreview, detectToolError, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'

export interface WriteToolInput {
  file_path: string
  content: string
}

interface WriteToolCallContentPropsWithSnapshot extends ToolCallContentProps<WriteToolInput> {
  fileSnapshot?: string
  isGroupItem?: boolean
}

export function WriteToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  fileSnapshot,
  isGroupItem,
}: WriteToolCallContentPropsWithSnapshot) {
  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  const isNewFile = !fileSnapshot || fileSnapshot.trim() === ''
  const hasError = toolResultContent ? detectToolError('Write', toolResultContent) : false
  const preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null
  const showDiff = approvalStatus === 'pending' || approvalStatus === undefined

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Write"
        description={isNewFile ? 'Create new file' : 'Overwrite file'}
        primaryParam={<span className="font-mono text-sm">{toolInput.file_path}</span>}
        nameColor={statusColor}
        status={<StatusBadge status={approvalStatus} />}
      />

      {showDiff && (
        <div className="mt-2">
          <DiffViewer
            oldContent={fileSnapshot || ''}
            newContent={toolInput.content || ''}
            mode="unified"
            showFullFile={false}
          />
        </div>
      )}

      {!showDiff && isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError ? preview || 'Error writing file' : isNewFile ? 'File created' : 'File written'}
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
