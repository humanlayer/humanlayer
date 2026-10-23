import type { FC } from 'react'
import { OpenableFilename } from '@humanlayer/ui/components/openable-filename'
import { DiffViewer } from '../diff-viewer'
import { StatusBadge } from '../status-badge'
import type { ToolCallContentProps, WriteToolInput } from '../types'
import { formatFilePath, getApprovalStatusColor } from '../utils/formatters'

export interface WriteToolCallContentProps extends ToolCallContentProps<WriteToolInput> {
	workingDir?: string
	fileSnapshot?: string // Add for diff comparison
	onOpenFile?: (filePath: string) => void
}

export const WriteToolCallContent: FC<WriteToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	workingDir,
	fileSnapshot,
	onOpenFile,
}) => {
	const displayPath = formatFilePath(toolInput.file_path, workingDir)
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor
	const isDenied = approvalStatus === 'denied'
	const isNewFile = !fileSnapshot || fileSnapshot.trim() === ''

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Write</span>
						<span className="text-sm text-muted-foreground">
							{isNewFile ? 'Create new file' : 'Overwrite file'}
						</span>
						<OpenableFilename
							path={toolInput.file_path}
							displayPath={displayPath}
							onOpen={onOpenFile}
						/>
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{/* Show diff view - comparing fileSnapshot (or empty) with new content */}
			{toolInput.content && (
				<div className="mt-2">
					<DiffViewer
						oldContent={fileSnapshot || ''}
						newContent={toolInput.content || ''}
						showFullFile={false}
						fileName={toolInput.file_path}
					/>
				</div>
			)}

			{isDenied && toolResultContent && (
				<div className="mt-1 text-sm text-[var(--terminal-error)] font-mono flex items-start gap-1">
					<span className="text-[var(--terminal-error)]/50">⎿</span>
					<span>{toolResultContent}</span>
				</div>
			)}

			{!isDenied && (
				<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className={isFocused ? 'text-muted-foreground/50' : 'invisible'}>⎿</span>
					<span className={`text-sm text-muted-foreground/50 ${isFocused ? '' : 'invisible'}`}>
						<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
						{onOpenFile && (
							<>
								<span className="mx-1">·</span>
								<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">o</kbd> open
							</>
						)}
					</span>
				</div>
			)}
		</div>
	)
}
