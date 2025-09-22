import { CommandToken } from '../../CommandToken'
import { BashToolCallContentProps } from './types'
import { StatusBadge } from './StatusBadge'

export function BashToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent
}: BashToolCallContentProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold">Bash</span>
            {toolInput.description && (
              <span className="text-sm text-muted-foreground">{toolInput.description}</span>
            )}
          </div>
          <div className="mt-1">
            <CommandToken>{toolInput.command}</CommandToken>
          </div>
        </div>
        <div className="ml-4">
          <StatusBadge approvalStatus={approvalStatus} isCompleted={isCompleted} />
        </div>
      </div>

      {toolInput.run_in_background && (
        <div className="text-xs text-muted-foreground">
          Running in background
        </div>
      )}

      {toolInput.timeout && (
        <div className="text-xs text-muted-foreground">
          Timeout: {toolInput.timeout}ms
        </div>
      )}

      {toolResultContent && (
        <div className="mt-3 p-3 rounded-md bg-muted/50 border border-border">
          <div className="text-xs text-muted-foreground mb-1">Output:</div>
          <pre className="text-sm font-mono whitespace-pre-wrap break-all">
            {toolResultContent.slice(0, 500)}
            {toolResultContent.length > 500 && (
              <span className="text-muted-foreground">... (truncated)</span>
            )}
          </pre>
        </div>
      )}
    </div>
  )
}