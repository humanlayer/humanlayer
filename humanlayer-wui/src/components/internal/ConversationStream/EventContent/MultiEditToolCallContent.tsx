import { useState } from 'react'
import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { DiffViewer } from './DiffViewer/DiffViewer'
import { DiffViewToggle } from './DiffViewToggle'
import { formatToolResultPreview, detectToolError, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'
import { ApprovalStatus } from '@humanlayer/hld-sdk'
import { processEscapeSequences } from '@/utils/escapeSequences'

export interface MultiEditToolInput {
  file_path: string
  edits: Array<{
    old_string: string
    new_string: string
    replace_all?: boolean
  }>
}

export function MultiEditToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
  fileSnapshot,
  isGroupItem,
}: ToolCallContentProps<MultiEditToolInput> & {
  fileSnapshot?: { content: string }
  isGroupItem?: boolean
}) {
  const [isSplitView, setIsSplitView] = useState(false)
  const isDenied = approvalStatus === ApprovalStatus.Denied
  const hasError = toolResultContent ? detectToolError('MultiEdit', toolResultContent) : false
  let preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null
  const showDiff = approvalStatus === 'pending' || approvalStatus === undefined || !isCompleted

  if (isDenied) {
    preview = `Denial Reason: ${toolResultContent ? formatToolResultPreview(toolResultContent) : null}`
  }

  const toggleView = () => setIsSplitView(!isSplitView)

  // Apply all edits sequentially to the file content for diff display
  const getResultContent = () => {
    // Defensive check for edits array
    const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []

    if (!fileSnapshot?.content) {
      // If no snapshot, create a simplified diff from the edits themselves
      return {
        oldContent: edits.map(e => e.old_string || '').join('\n...\n'),
        newContent: edits.map(e => e.new_string || '').join('\n...\n'),
      }
    }

    // Apply edits sequentially to the file content
    let resultContent = fileSnapshot.content
    for (const edit of edits) {
      if (edit.replace_all) {
        resultContent = resultContent.split(edit.old_string).join(edit.new_string)
      } else {
        resultContent = resultContent.replace(edit.old_string, edit.new_string)
      }
    }

    return {
      oldContent: fileSnapshot.content,
      newContent: resultContent,
    }
  }

  const { oldContent, newContent } = getResultContent()
  const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []
  const editCount = edits.length
  const replaceAllCount = edits.filter(e => e.replace_all).length

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div className="space-y-2">
      <ToolHeader
        name="MultiEdit"
        description={replaceAllCount > 0 ? `${replaceAllCount} replace-all` : undefined}
        primaryParam={
          <span className="text-sm">
            <span className="text-muted-foreground">
              {editCount} edit{editCount === 1 ? '' : 's'} to{' '}
            </span>
            <span className="font-mono">{toolInput.file_path}</span>
          </span>
        }
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
          oldContent={processEscapeSequences(oldContent)}
          newContent={processEscapeSequences(newContent)}
          mode={isSplitView ? 'split' : 'unified'}
          showFullFile={!!fileSnapshot}
        />
      </div>

      {!showDiff && isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError
              ? preview || 'Error applying edits'
              : `${editCount} edit${editCount === 1 ? '' : 's'} applied successfully`}
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
