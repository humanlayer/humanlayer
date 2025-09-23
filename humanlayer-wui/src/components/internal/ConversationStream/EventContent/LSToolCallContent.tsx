import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'
import { ToolHeader } from './ToolHeader'
import { getApprovalStatusColor } from './utils/formatters'

interface LSToolInput {
  path: string
  recursive?: boolean
}

export function LSToolCallContent({
  toolInput,
  approvalStatus,
  toolResultContent,
  isFocused,
  isGroupItem,
}: ToolCallContentProps<LSToolInput>) {
  const formatLSResult = (content: string) => {
    if (!content || !content.trim()) {
      return 'Empty directory'
    }

    const lines = content.split('\n').filter(l => l.trim())

    // Count items (files and directories)
    let fileCount = 0
    let dirCount = 0

    // Simple heuristic to count files and directories
    for (const line of lines) {
      const trimmedLine = line.trim()
      if (trimmedLine.endsWith('/')) {
        dirCount++
      } else if (
        trimmedLine &&
        !trimmedLine.startsWith('├') &&
        !trimmedLine.startsWith('│') &&
        !trimmedLine.startsWith('└')
      ) {
        fileCount++
      }
    }

    const items = []
    if (dirCount > 0) items.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}`)
    if (fileCount > 0) items.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`)

    if (items.length === 0) {
      // If we couldn't parse, just show line count
      return `${lines.length} item${lines.length === 1 ? '' : 's'}`
    }

    return items.join(', ')
  }

  const formattedResult = toolResultContent ? formatLSResult(toolResultContent) : null

  const approvalStatusColor = getApprovalStatusColor(approvalStatus)
  let statusColor =
    isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <ToolHeader
          name="List"
          description={toolInput.recursive ? 'recursive' : undefined}
          primaryParam={toolInput.path}
          nameColor={statusColor}
        />
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
