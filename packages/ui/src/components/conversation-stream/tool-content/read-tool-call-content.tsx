import type { FC } from 'react'
import { OpenableFilename } from '@humanlayer/ui/components/openable-filename'
import { StatusBadge } from '../status-badge'
import type { ReadToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, formatLineCount, formatToolResult, getApprovalStatusColor } from '../utils/formatters'

export interface ReadToolCallContentProps extends ToolCallContentProps<ReadToolInput> {
	workingDir?: string
	onOpenFile?: (filePath: string) => void
}

export const ReadToolCallContent: FC<ReadToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	workingDir,
	onOpenFile,
}) => {
	const lineCount = toolResultContent ? formatLineCount(toolResultContent) : null
	const formattedResult = toolResultContent ? formatToolResult(toolResultContent) : null
	const displayPath = formatFilePath(toolInput.file_path, workingDir)
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor

	// Build display path with line numbers if applicable
	const displayPathWithLines = (() => {
		if (toolInput.limit || toolInput.offset !== undefined) {
			const startLine = toolInput.offset || 1
			const endLine = toolInput.limit ? startLine + toolInput.limit - 1 : undefined
			const lineRange = endLine ? `:${startLine}-${endLine}` : `:${startLine}-`
			return `${displayPath}${lineRange}`
		}
		return displayPath
	})()

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2 flex-wrap">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Read</span>
						<OpenableFilename
							path={toolInput.file_path}
							displayPath={displayPathWithLines}
							onOpen={onOpenFile}
						/>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{(formattedResult || lineCount) && (
				<div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span>
						{(() => {
							if (!formattedResult) {
								return `Read ${lineCount}`
							}
							// If formattedResult has line count, replace with accurate count
							const hasLineCount = formattedResult.includes(' lines)')
							if (hasLineCount && lineCount) {
								return formattedResult.replace(/\(\d+ lines\)/, `(${lineCount})`)
							}
							// Single line case or no line count in preview
							if (lineCount && !hasLineCount) {
								// If it's a truncated preview, add the line count
								if (formattedResult.endsWith('...')) {
									return `${formattedResult} (${lineCount})`
								}
							}
							return formattedResult
						})()}
						<span className={`text-sm text-muted-foreground/50 ml-2 ${isFocused ? '' : 'invisible'}`}>
							<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
							{onOpenFile && (
								<>
									<span className="mx-1">·</span>
									<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">o</kbd> open
								</>
							)}
						</span>
					</span>
				</div>
			)}
		</div>
	)
}
