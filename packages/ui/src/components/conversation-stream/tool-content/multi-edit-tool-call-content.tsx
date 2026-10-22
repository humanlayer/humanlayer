import type { FC } from 'react'
import { OpenableFilename } from '@humanlayer/ui/components/openable-filename'
import { DiffViewer } from '../diff-viewer'
import { StatusBadge } from '../status-badge'
import type { MultiEditToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, getApprovalStatusColor } from '../utils/formatters'

export interface MultiEditToolCallContentProps extends ToolCallContentProps<MultiEditToolInput> {
	workingDir?: string
	onOpenFile?: (filePath: string) => void
	fileSnapshot?: { content: string }
}

export const MultiEditToolCallContent: FC<MultiEditToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	isCompleted, // Keep in signature for API compatibility, but we always show the diff now
	workingDir,
	onOpenFile,
	fileSnapshot,
}) => {
	void isCompleted // Mark as intentionally unused
	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor
	const isDenied = approvalStatus === 'denied'

	const edits = Array.isArray(toolInput.edits) ? toolInput.edits : []

	// Apply all edits sequentially to get the full diff
	const getResultContent = () => {
		if (!fileSnapshot?.content) {
			// If no snapshot, create a simplified diff from the edits themselves
			return {
				oldContent: edits.map(e => e.old_string || '').join('\n...\n'),
				newContent: edits.map(e => e.new_string || '').join('\n...\n'),
			}
		}

		// Apply edits sequentially to the file content
		let resultContent = fileSnapshot.content
		for (const edit of edits) {
			if (edit.replace_all) {
				resultContent = resultContent.split(edit.old_string).join(edit.new_string)
			} else {
				resultContent = resultContent.replace(edit.old_string, edit.new_string)
			}
		}

		return {
			oldContent: fileSnapshot.content,
			newContent: resultContent,
		}
	}

	const { oldContent, newContent } = getResultContent()

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>MultiEdit</span>
						<OpenableFilename
							path={toolInput.file_path}
							displayPath={formatFilePath(toolInput.file_path, workingDir)}
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
					oldContent={oldContent}
					newContent={newContent}
					showFullFile={!!fileSnapshot}
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
