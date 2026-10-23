import type { FC } from 'react'
import { StatusBadge } from '../status-badge'
import type { NotebookEditToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, getApprovalStatusColor, truncateText } from '../utils/formatters'

export interface NotebookEditToolCallContentProps extends ToolCallContentProps<NotebookEditToolInput> {
	workingDir?: string
}

export const NotebookEditToolCallContent: FC<NotebookEditToolCallContentProps> = ({
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
	const editMode = toolInput.edit_mode || 'replace'
	const showDiff = approvalStatus === 'pending' || approvalStatus === undefined || !isCompleted

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>NotebookEdit</span>
						<span className="text-sm text-muted-foreground">
							{editMode} cell in{' '}
						</span>
						<code className="text-sm font-mono text-muted-foreground">{displayPath}</code>
					</div>
					{toolInput.cell_number !== undefined && (
						<div className="text-sm text-muted-foreground mt-1">Cell: {toolInput.cell_number}</div>
					)}
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{showDiff && editMode !== 'delete' && toolInput.new_source && (
				<div className="mt-2 border rounded p-2 bg-muted/20">
					<div className="text-sm text-muted-foreground mb-1">
						{editMode === 'insert' ? 'New Cell Content:' : 'Cell Content:'}
						{toolInput.cell_type && (
							<span className="ml-2 px-2 py-0.5 bg-muted rounded text-sm">{toolInput.cell_type}</span>
						)}
					</div>
					<pre className="text-sm font-mono bg-muted/30 p-2 rounded overflow-x-auto max-h-32">
						{truncateText(toolInput.new_source, 400)}
					</pre>
				</div>
			)}

			{editMode === 'delete' && showDiff && (
				<div className="mt-2 text-sm text-muted-foreground">
					Will delete cell{toolInput.cell_number !== undefined && ` ${toolInput.cell_number}`}
				</div>
			)}

			{!showDiff && isCompleted && (
				<div className="mt-1 text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className="text-muted-foreground/50">⎿</span>
					<span className={isDenied ? 'text-[var(--terminal-error)]' : ''}>
						{isDenied
							? toolResultContent
							: `Cell ${editMode === 'delete' ? 'deleted' : editMode === 'insert' ? 'inserted' : 'updated'} successfully`}
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
