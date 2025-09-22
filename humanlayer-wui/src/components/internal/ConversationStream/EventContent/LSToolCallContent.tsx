import { CommandToken } from '../../CommandToken'
import { StatusBadge } from './StatusBadge'
import { ToolCallContentProps } from './types'

interface LSToolInput {
  path: string
  recursive?: boolean
}

export function LSToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
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

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">LS</span>
            {toolInput.recursive && <span className="text-sm text-muted-foreground">recursive</span>}
          </div>
          <div className="mt-1">
            <CommandToken>{toolInput.path}</CommandToken>
          </div>
        </div>
        <div className="ml-4">
          <StatusBadge approvalStatus={approvalStatus} isCompleted={isCompleted} />
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
