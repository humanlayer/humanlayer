import { CommandToken } from '../../CommandToken'
import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'
import { getApprovalStatusColor } from './utils/formatters'

interface GlobToolInput {
  pattern: string
  path?: string
}

export function GlobToolCallContent({
  toolInput,
  approvalStatus,
  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<GlobToolInput>) {
  const formatGlobResult = (content: string) => {
    const lines = content.split('\n').filter(l => l.trim())
    if (lines.length === 0) {
      return 'No files matched'
    }

    // Show count and first few files
    if (lines.length === 1) {
      const fileName = lines[0].split('/').pop() || lines[0]
      return `1 file: ${fileName}`
    }

    return `${lines.length} file${lines.length === 1 ? '' : 's'} matched`
  }

  const formattedResult = toolResultContent ? formatGlobResult(toolResultContent) : null

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className={`font-semibold ${statusColor || ''}`}>Glob</span>
            <CommandToken>{toolInput.pattern}</CommandToken>
          </div>
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
