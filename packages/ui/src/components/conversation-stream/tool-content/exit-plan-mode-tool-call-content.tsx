import { MarkdownRenderer } from '@humanlayer/ui/components/markdown-renderer'
import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { ExitPlanModeToolInput, ToolCallContentProps } from '../types'
import { formatToolResult, getApprovalStatusColor } from '../utils/formatters'

export const ExitPlanModeToolCallContent: FC<ToolCallContentProps<ExitPlanModeToolInput>> = ({
	toolInput,
	approvalStatus,
	isCompleted,
	toolResultContent,
	isGroupItem,
}) => {
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const isDenied = approvalStatus === 'denied'
	let preview = toolResultContent ? formatToolResult(toolResultContent) : null

	if (isDenied && !preview) {
		preview = 'Denied'
	}

	const planLines = toolInput.plan.split('\n').filter((l) => l.trim())
	const lineCount = planLines.length

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Exit Plan Mode</span>
						<span className="text-sm text-muted-foreground">{lineCount} lines</span>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			<div className="mt-2">
				<MarkdownRenderer content={toolInput.plan} />
			</div>

			{isCompleted && (
				<div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span className={isDenied ? 'text-[var(--terminal-error)]' : ''}>
						{isDenied && (preview || 'Denied')}
						{!isDenied && 'Plan mode exited successfully'}
					</span>
				</div>
			)}
		</div>
	)
}
