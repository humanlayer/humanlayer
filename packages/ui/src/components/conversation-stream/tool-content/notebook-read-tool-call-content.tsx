import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { NotebookReadToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, formatToolResult, getApprovalStatusColor } from '../utils/formatters'

export interface NotebookReadToolCallContentProps extends ToolCallContentProps<NotebookReadToolInput> {
	workingDir?: string
}

export const NotebookReadToolCallContent: FC<NotebookReadToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	isCompleted,
	workingDir,
}) => {
	const displayPath = formatFilePath(toolInput.notebook_path, workingDir)
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor
	const isDenied = approvalStatus === 'denied'
	const formattedResult = toolResultContent ? formatToolResult(toolResultContent) : null

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>NotebookRead</span>
						<code className="text-sm font-mono text-muted-foreground">{displayPath}</code>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{isCompleted && formattedResult && (
				<div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span className={isDenied ? 'text-[var(--terminal-error)]' : ''}>
						{formattedResult}
						{isFocused && !isDenied && (
							<span className="text-sm text-muted-foreground/50 ml-2">
								<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
							</span>
						)}
					</span>
				</div>
			)}
		</div>
	)
}
