import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { ToolCallContentProps } from '../types'
import { getApprovalStatusColor, parseMcpTextContent } from '../utils/formatters'

export interface CommentResolveToolInput {
	artifact_filename: string
	comment_ids: string[]
	resolved?: boolean
	deleted?: boolean
}

export const CommentResolveToolCallContent: FC<ToolCallContentProps<CommentResolveToolInput>> = ({
	toolInput,
	approvalStatus,
	isCompleted,
	toolResultContent,
	isGroupItem,
}) => {
	const count = toolInput.comment_ids?.length ?? 0
	const action = toolInput.deleted ? 'Deleted' : 'Resolved'
	const label = `CommentResolve: ${toolInput.artifact_filename}`
	const detail = `${action} ${count} comment${count === 1 ? '' : 's'}`

	const resultText = (() => {
		if (!isCompleted || !toolResultContent) return detail
		const parsed = parseMcpTextContent(toolResultContent)
		if (!parsed) return detail
		if (parsed.includes('Updated')) return `✓ ${detail}`
		if (parsed.includes('error') || parsed.includes('failed')) return `✗ ${parsed.split('\n')[0]}`
		return detail
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

			<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
				<span className="text-muted-foreground/50">⎿</span>
				<span>{resultText}</span>
			</div>
		</div>
	)
}
