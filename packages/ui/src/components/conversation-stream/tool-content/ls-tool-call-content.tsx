import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { LSToolInput, ToolCallContentProps } from '../types'
import { getApprovalStatusColor } from '../utils/formatters'

export const LSToolCallContent: FC<ToolCallContentProps<LSToolInput>> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
}) => {
	const formatLSResult = (content: string) => {
		if (!content || !content.trim()) {
			return 'Empty directory'
		}

		const lines = content.split('\n').filter((l) => l.trim())

		let fileCount = 0
		let dirCount = 0

		for (const line of lines) {
			const trimmedLine = line.trim()
			if (trimmedLine.endsWith('/')) {
				dirCount++
			} else if (
				trimmedLine &&
				!trimmedLine.startsWith('├') &&
				!trimmedLine.startsWith('│') &&
				!trimmedLine.startsWith('└')
			) {
				fileCount++
			}
		}

		const items = []
		if (dirCount > 0) items.push(`${dirCount} director${dirCount === 1 ? 'y' : 'ies'}`)
		if (fileCount > 0) items.push(`${fileCount} file${fileCount === 1 ? '' : 's'}`)

		if (items.length === 0) {
			return `${lines.length} item${lines.length === 1 ? '' : 's'}`
		}

		return items.join(', ')
	}

	const formattedResult = toolResultContent ? formatLSResult(toolResultContent) : null

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>List</span>
						{toolInput.recursive && (
							<span className="text-sm text-muted-foreground">recursive</span>
						)}
					</div>
					<div className="mt-1 font-mono text-sm text-muted-foreground">{toolInput.path}</div>
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
