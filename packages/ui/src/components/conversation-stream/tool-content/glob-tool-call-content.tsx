import { CommandToken } from '@humanlayer/ui/components/command-token'
import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { GlobToolInput, ToolCallContentProps } from '../types'
import { getApprovalStatusColor } from '../utils/formatters'

export const GlobToolCallContent: FC<ToolCallContentProps<GlobToolInput>> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const formatGlobResult = (content: string) => {
		const lines = content.split('\n').filter((l) => l.trim())
		if (lines.length === 0) {
			return 'No files matched'
		}

		if (lines.length === 1) {
			const firstLine = lines[0]
			if (firstLine !== undefined) {
				const fileName = firstLine.split('/').pop() || firstLine
				return `1 file: ${fileName}`
			}
		}

		return `${lines.length} file${lines.length === 1 ? '' : 's'} matched`
	}

	const formattedResult = toolResultContent ? formatGlobResult(toolResultContent) : null

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Glob</span>
						<CommandToken>{toolInput.pattern}</CommandToken>
					</div>
					{toolInput.path && (
						<div className="text-sm text-muted-foreground mt-1">in {toolInput.path}</div>
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
						{isFocused && toolResultContent && toolResultContent.split('\n').length > 1 && (
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
