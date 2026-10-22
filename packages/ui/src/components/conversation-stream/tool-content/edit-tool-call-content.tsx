import type { FC } from 'react'
import { OpenableFilename } from '@humanlayer/ui/components/openable-filename'
import { DiffViewer } from '../diff-viewer'
import { StatusBadge } from '../status-badge'
import type { EditToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, getApprovalStatusColor } from '../utils/formatters'

export interface EditToolCallContentProps extends ToolCallContentProps<EditToolInput> {
	workingDir?: string
	onOpenFile?: (filePath: string) => void
}

export const EditToolCallContent: FC<EditToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	isCompleted, // Keep in signature for API compatibility, but we always show the diff now
	workingDir,
	onOpenFile,
}) => {
	void isCompleted // Mark as intentionally unused
	const displayPath = formatFilePath(toolInput.file_path, workingDir)
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor
	const isDenied = approvalStatus === 'denied'


	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Edit</span>
						{toolInput.replace_all && (
							<span className="text-sm text-muted-foreground">Replace all occurrences</span>
						)}
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

			{/* Always show the diff - this is the important content users want to see */}
			<div className="mt-2">
				<DiffViewer
					oldContent={toolInput.old_string || ''}
					newContent={toolInput.new_string || ''}
					showFullFile={false}
					fileName={toolInput.file_path}
				/>
			</div>

			{/* Show keyboard hints - always reserve space to prevent layout shift */}
			{!isDenied && (
				<div className="text-sm text-muted-foreground font-mono flex items-start gap-1">
					<span className={isFocused ? 'text-muted-foreground/50' : 'invisible'}>⎿</span>
					<span className={`text-xs text-muted-foreground/50 ${isFocused ? '' : 'invisible'}`}>
						<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">i</kbd> expand
						{onOpenFile && (
							<>
								<span className="mx-1">·</span>
								<kbd className="px-1 py-0.5 text-xs bg-muted/50 rounded">o</kbd> open
							</>
						)}
					</span>
				</div>
			)}

			{/* Show error/denial message if applicable */}
			{isDenied && toolResultContent && (
				<div className="mt-1 text-sm text-[var(--terminal-error)] font-mono flex items-start gap-1">
					<span className="text-[var(--terminal-error)]/50">⎿</span>
					<span>{toolResultContent}</span>
				</div>
			)}
		</div>
	)
}
