import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { ToolCallContentProps } from '../types'
import { getApprovalStatusColor, truncateText } from '../utils/formatters'

export interface CommentReplyToolInput {
	artifact_filename: string
	comment_id: string
	content: string
}

export const CommentReplyToolCallContent: FC<ToolCallContentProps<CommentReplyToolInput>> = ({
	toolInput,
	approvalStatus,
	isFocused,
	isGroupItem,
}) => {
	const label = `CommentReply: ${toolInput.artifact_filename}`
	const firstLine = toolInput.content?.split('\n')[0]
	const preview = firstLine ? truncateText(firstLine, 50) : null

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

			{preview && (
				<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span>
						{preview}
						<span className={`text-sm text-muted-foreground/50 ml-2 ${isFocused ? '' : 'invisible'}`}>
							<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
						</span>
					</span>
				</div>
			)}
		</div>
	)
}
