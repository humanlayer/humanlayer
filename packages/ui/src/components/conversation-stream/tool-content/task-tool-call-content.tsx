import { ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { TaskToolInput, ToolCallContentProps } from '../types'
import { truncateText, getApprovalStatusColor } from '../utils/formatters'

export const TaskToolCallContent: FC<ToolCallContentProps<TaskToolInput>> = ({
	toolInput,
	approvalStatus,
	isCompleted,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const getResultPreview = () => {
		if (!toolResultContent) return null
		const firstLine = toolResultContent.split('\n')[0]
		return truncateText(firstLine, 80)
	}

	const resultPreview = getResultPreview()

	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-start justify-between w-full">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>
							{toolInput.subagent_type || 'Agent'}
						</span>
						{toolInput.description && (
							<span className="text-sm text-muted-foreground">{toolInput.description}</span>
						)}
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{!isCompleted && toolInput?.prompt && (
				<div className="text-sm text-muted-foreground ml-4">
					<ChevronRight className="inline-block w-3 h-3 mr-1" />
					<span className="italic">{truncateText(toolInput.prompt, 100)}</span>
				</div>
			)}

			{resultPreview && <div className="text-sm text-muted-foreground ml-4 mt-1">{resultPreview}</div>}

			{isFocused && isCompleted && toolResultContent && (
				<div className="text-sm text-muted-foreground/60 ml-4">
					<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
				</div>
			)}
		</div>
	)
}
