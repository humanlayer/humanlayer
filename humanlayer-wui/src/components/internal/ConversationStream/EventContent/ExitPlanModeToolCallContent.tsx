import { ToolHeader } from './ToolHeader'
import { StatusBadge } from './StatusBadge'
import { MarkdownRenderer } from '@/components/internal/SessionDetail/MarkdownRenderer'
import { formatToolResultPreview, detectToolError, getApprovalStatusColor } from './utils/formatters'
import { ToolCallContentProps } from './types'
import { ApprovalStatus } from '@humanlayer/hld-sdk'

export interface ExitPlanModeToolInput {
  plan: string
}

export function ExitPlanModeToolCallContent({
  toolInput,
  approvalStatus,
  isCompleted,
  toolResultContent,
  isFocused,
}: ToolCallContentProps<ExitPlanModeToolInput>) {
  const isDenied = approvalStatus === ApprovalStatus.Denied
  const hasError = toolResultContent ? detectToolError('ExitPlanMode', toolResultContent) : false
  let preview = toolResultContent ? formatToolResultPreview(toolResultContent) : null

  if (isDenied) {
    preview = `Denial Reason: ${toolResultContent ? formatToolResultPreview(toolResultContent) : null}`
  }

  const planLines = toolInput.plan.split('\n').filter(l => l.trim())
  const lineCount = planLines.length
  const showPlan =
    approvalStatus === 'pending' || approvalStatus === undefined || !isCompleted || isFocused

  return (
    <div className="space-y-2">
      <ToolHeader
        name="Exit Plan Mode"
        description={`${lineCount} lines`}
        nameColor={getApprovalStatusColor(approvalStatus)}
        status={<StatusBadge status={approvalStatus} />}
      />

      {showPlan && (
        <div className="mt-2">
          <MarkdownRenderer content={toolInput.plan} sanitize={false} />
        </div>
      )}

      {!showPlan && isCompleted && (
        <div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
          <span className="text-muted-foreground/50">⎿</span>
          <span className={hasError ? 'text-destructive' : ''}>
            {hasError ? preview || 'Error exiting plan mode' : 'Plan mode exited successfully'}
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
