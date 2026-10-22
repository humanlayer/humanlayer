import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { ToolCallContentProps } from '../types'
import { getApprovalStatusColor, parseMcpTextContent } from '../utils/formatters'

export interface CommentGetToolInput {
	artifact_filename: string
	include_resolved?: boolean
	limit?: number
	offset?: number
}

export const CommentGetToolCallContent: FC<ToolCallContentProps<CommentGetToolInput>> = ({
	toolInput,
	approvalStatus,
	isCompleted,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const label = `CommentGet: ${toolInput.artifact_filename}`

	const resultSummary = (() => {
		if (!isCompleted || !toolResultContent) return null
		const parsed = parseMcpTextContent(toolResultContent)
		if (!parsed) return null
		// Count <comment> tags to determine comment count
		const commentCount = (parsed.match(/<comment\b/g) || []).length
		if (commentCount > 0) return `${commentCount} comment${commentCount === 1 ? '' : 's'}`
		if (parsed.includes('No comments')) return 'No comments'
		return parsed.split('\n')[0]
	})()

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>{label}</span>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{resultSummary && (
				<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span>
						{resultSummary}
						{isFocused && toolResultContent && (
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
