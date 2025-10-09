interface BashOutputToolCallContentProps {
  toolName?: string
  toolInput?: any
  isCompleted?: boolean
  toolResultContent?: string
  isFocused?: boolean
  isGroupItem?: boolean
}

const parseToolResultContent = (toolResultContent: string) => {
  // Wrap in a root element since XML requires one
  const wrapped = `<response>${toolResultContent}</response>`
  const parser = new DOMParser()
  const xmlDoc = parser.parseFromString(wrapped, 'text/xml')

  const status = xmlDoc.querySelector('status')?.textContent
  const exitCode = parseInt(xmlDoc.querySelector('exit_code')?.textContent || '-10000', 10)
  const stdout = xmlDoc.querySelector('stdout')?.textContent
  const stderr = xmlDoc.querySelector('stderr')?.textContent
  const timestamp = xmlDoc.querySelector('timestamp')?.textContent

  return {
    status,
    exitCode,
    stdout,
    stderr,
    timestamp,
  }
}

/**
 * Component for displaying BashOutput tool calls.
 * Used to retrieve output from background bash shells.
 */
export function BashOutputToolCallContent({
  toolInput,
  isCompleted,
  toolResultContent,
  isFocused,
  isGroupItem = false,
}: BashOutputToolCallContentProps) {
  // Format the tool input for display
  const parsedToolResultContent = parseToolResultContent(toolResultContent || '')

  return (
    <div className={`overflow-hidden ${isGroupItem ? 'text-xs' : 'text-sm'}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="font-medium text-muted-foreground">{'Bash Output'}</span>
          <span className="text-muted-foreground/60 text-xs">{toolInput.bash_id || 'No ID'}</span>
        </div>

        {isCompleted && toolResultContent && parsedToolResultContent.exitCode === 0 && (
          <div className="text-xs text-muted-foreground/60 truncate">
            <span className="text-muted-foreground/50">⎿</span>
            <span>
              {parsedToolResultContent.stdout && parsedToolResultContent.stdout.length > 100
                ? `${parsedToolResultContent.stdout.substring(0, 100)}...`
                : parsedToolResultContent.stdout}

              {isFocused && (
                <span className="text-xs text-muted-foreground/50 ml-2">
                  <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
                </span>
              )}
            </span>
          </div>
        )}

        {isCompleted && toolResultContent && parsedToolResultContent.exitCode !== 0 && (
          <div className="text-xs truncate text-destructive">
            <span className="text-muted-foreground/50">⎿</span>
            <span>
              {parsedToolResultContent.stderr && parsedToolResultContent.stderr.length > 100
                ? `${parsedToolResultContent.stderr.substring(0, 100)}...`
                : parsedToolResultContent.stderr}

              {isFocused && (
                <span className="text-xs text-muted-foreground/50 ml-2">
                  <kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
