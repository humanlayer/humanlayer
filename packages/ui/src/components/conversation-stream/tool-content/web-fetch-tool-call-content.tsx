import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { WebFetchToolInput, ToolCallContentProps } from '../types'
import { getApprovalStatusColor } from '../utils/formatters'

export const WebFetchToolCallContent: FC<ToolCallContentProps<WebFetchToolInput>> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const formatFetchResult = (content: string) => {
		const charCount = content.length
		if (charCount > 0) {
			const kbSize = (charCount / 1024).toFixed(1)
			return `Fetched ${kbSize}KB of content`
		}
		return 'No content retrieved'
	}

	const formattedResult = toolResultContent ? formatFetchResult(toolResultContent) : null

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Web Fetch</span>
					</div>
					<div className="mt-1">
						<a
							href={toolInput.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-sm text-accent underline hover:text-accent/80 transition-colors"
						>
							{toolInput.url}
						</a>
					</div>
					{toolInput.prompt && (
						<div className="text-sm text-muted-foreground italic mt-1">&ldquo;{toolInput.prompt}&rdquo;</div>
					)}
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
						{isFocused && toolResultContent && toolResultContent.length > 100 && (
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
