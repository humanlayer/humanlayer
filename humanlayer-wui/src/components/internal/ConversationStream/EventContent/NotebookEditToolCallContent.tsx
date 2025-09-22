import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { formatToolResultPreview, detectToolError, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'
import { ApprovalStatus } from '@humanlayer/hld-sdk'

export interface NotebookEditToolInput {
  notebook_path: string
  cell_id?: string
  new_source: string
  cell_type?: 'code' | 'markdown'
  edit_mode?: 'replace' | 'insert' | 'delete'
}

export function NotebookEditToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
}: ToolCallContentProps<NotebookEditToolInput>) {
  const isDenied = approvalStatus === ApprovalStatus.Denied
  const hasError = toolResultContent ? detectToolError('NotebookEdit', toolResultContent) : false
  let preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null

  if (isDenied) {
    preview = `Denial Reason: ${toolResultContent ? formatToolResultPreview(toolResultContent) : null}`
  }

  const editMode = toolInput.edit_mode || 'replace'
  const showDiff = approvalStatus === 'pending' || approvalStatus === undefined || !isCompleted

  return (
    <div className="space-y-2">
      <ToolHeader
        name="NotebookEdit"
        description={toolInput.cell_id ? `Cell: ${toolInput.cell_id}` : undefined}
        primaryParam={
          <span className="text-sm">
            <span className="text-muted-foreground">{editMode} cell in </span>
            <span className="font-mono">{toolInput.notebook_path}</span>
          </span>
        }
        nameColor={getApprovalStatusColor(approvalStatus)}
        status={<StatusBadge status={approvalStatus} />}
      />

      {showDiff && editMode !== 'delete' && (
        <div className="mt-2 border rounded p-3 bg-muted/20">
          <div className="text-xs text-muted-foreground mb-2">
            {editMode === 'insert' ? 'New Cell Content:' : 'Cell Content:'}
            {toolInput.cell_type && (
              <span className="ml-2 px-2 py-0.5 bg-muted rounded text-xs">{toolInput.cell_type}</span>
            )}
          </div>
          <pre className="text-xs font-mono bg-muted/30 p-2 rounded overflow-x-auto max-h-40">
            {toolInput.new_source}
          </pre>
        </div>
      )}

      {editMode === 'delete' && showDiff && (
        <div className="mt-2 text-sm text-muted-foreground">
          Will delete cell{toolInput.cell_id && ` ${toolInput.cell_id}`}
        </div>
      )}

      {!showDiff && isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError
              ? preview || 'Error editing notebook'
              : `Cell ${editMode === 'delete' ? 'deleted' : editMode === 'insert' ? 'inserted' : 'updated'} successfully`}
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
