import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { ToolCallContentProps } from '../types'
import { getApprovalStatusColor, parseMcpToolName, truncateText } from '../utils/formatters'

export interface MCPToolCallContentProps extends ToolCallContentProps<Record<string, unknown>> {
	toolName: string
}

export const MCPToolCallContent: FC<MCPToolCallContentProps> = ({
	toolName,
	toolInput,
	approvalStatus,
	isCompleted,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const { service, method } = parseMcpToolName(toolName)
	const formattedMethod = method.replace(/_/g, ' ')
	const displayName = `${service} - ${formattedMethod}`

	const resultPreview = (() => {
		if (!isCompleted || !toolResultContent) return null

		const firstLine = toolResultContent.split('\n')[0]
		return truncateText(firstLine, 50)
	})()

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	const formatToolInput = () => {
		if (!toolInput || Object.keys(toolInput).length === 0) return null
		try {
			const entries = Object.entries(toolInput).slice(0, 2)
			return entries
				.map(([key, value]) => {
					const displayValue =
						typeof value === 'string' && value.length > 30
							? truncateText(value, 30)
							: JSON.stringify(value)
					return `${key}: ${displayValue}`
				})
				.join(', ')
		} catch {
			return 'Complex input'
		}
	}

	const inputPreview = formatToolInput()

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>{displayName}</span>
					</div>
					{inputPreview && (
						<div className="text-sm text-muted-foreground mt-1 font-mono">{inputPreview}</div>
					)}
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{isCompleted && resultPreview && (
				<div className="text-sm text-muted-foreground mt-1">
					{resultPreview}
					<span className={`text-sm text-muted-foreground/50 ml-2 ${isFocused ? '' : 'invisible'}`}>
						<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
					</span>
				</div>
			)}
		</div>
	)
}
