import { CommandToken } from '@humanlayer/ui/components/command-token'
import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { GrepToolInput, ToolCallContentProps } from '../types'
import { getApprovalStatusColor } from '../utils/formatters'

export const GrepToolCallContent: FC<ToolCallContentProps<GrepToolInput>> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const formatGrepResult = (content: string) => {
		const lines = content.split('\n').filter((l) => l.trim())
		if (lines.length === 0) {
			return 'No matches found'
		}
		if (lines.length === 1 && content.toLowerCase().includes('no matches')) {
			return 'No matches found'
		}

		const outputMode = toolInput.output_mode || 'files_with_matches'

		if (outputMode === 'count') {
			const firstLine = lines[0]
			if (lines.length === 1) {
				return firstLine
			}
			return `${firstLine} ... (${lines.length} files with counts)`
		}

		if (outputMode === 'files_with_matches') {
			return `Found matches in ${lines.length} file${lines.length === 1 ? '' : 's'}`
		}

		return `${lines.length} matching line${lines.length === 1 ? '' : 's'}`
	}

	const formattedResult = toolResultContent ? formatGrepResult(toolResultContent) : null

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Grep</span>
						<span className="text-sm text-muted-foreground">
							<CommandToken>{toolInput.pattern}</CommandToken>
						</span>
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
				<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span>
						{formattedResult}
						{toolResultContent && toolResultContent.split('\n').length > 1 && (
							<span className={`text-sm text-muted-foreground/50 ml-2 ${isFocused ? '' : 'invisible'}`}>
								<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
							</span>
						)}
					</span>
				</div>
			)}
		</div>
	)
}
