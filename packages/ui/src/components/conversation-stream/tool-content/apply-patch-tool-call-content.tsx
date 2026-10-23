import type { FC } from 'react'
import { useMemo } from 'react'
import { PatchDiff } from '@pierre/diffs/react'
import { OpenableFilename } from '@humanlayer/ui/components/openable-filename'
import { diffLayoutUnsafeCSS, diffThemeStyleOverrides } from '../diff-style-overrides'
import { StatusBadge } from '../status-badge'
import type { ApplyPatchToolInput, ToolCallContentProps } from '../types'
import { formatFilePath, getApprovalStatusColor } from '../utils/formatters'
import { useDiffStyle } from '../../diff-style-provider'
import { useTheme } from '../../theme-provider'
import { themeToShiki } from '../../../lib/shiki-theme-mapping'
import {
	parseApplyPatch,
	type ParsedApplyPatchHunk,
} from './apply-patch-parser'

export interface ApplyPatchToolCallContentProps extends ToolCallContentProps<ApplyPatchToolInput> {
	workingDir?: string
	onOpenFile?: (filePath: string) => void
}

/**
 * Generate a unified diff for a new file (add operation).
 * Format:
 *   --- /dev/null
 *   +++ b/path/to/file.txt
 *   @@ -0,0 +1,N @@
 *   +line 1
 *   +line 2
 */
function sanitizeUnifiedDiffPath(filePath: string): string {
	return filePath.replace(/\n/g, ' ')
}

function generateUnifiedDiffForAdd(filePath: string, content: string): string {
	const lines = content.split('\n')
	// Remove trailing empty line if content ends with newline
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop()
	}
	const lineCount = lines.length

	const diffPath = sanitizeUnifiedDiffPath(filePath)
	const header = `diff --git a/${diffPath} b/${diffPath}
--- /dev/null
+++ b/${diffPath}
@@ -0,0 +1,${lineCount} @@`

	const diffLines = lines.map((l) => '+' + l).join('\n')

	return header + '\n' + diffLines
}

/**
 * Generate a unified diff for an update operation from parsed hunks.
 * Format:
 *   --- a/path/to/file.txt
 *   +++ b/path/to/file.txt
 *   @@ -1,N +1,M @@
 *   -old line
 *   +new line
 */
function generateUnifiedDiffForUpdate(filePath: string, hunks: ParsedApplyPatchHunk[]): string {
	const diffPath = sanitizeUnifiedDiffPath(filePath)
	const header = `diff --git a/${diffPath} b/${diffPath}
--- a/${diffPath}
+++ b/${diffPath}`

	const hunkStrings = hunks.map((hunk) => {
		const oldCount = hunk.oldLines.length
		const newCount = hunk.newLines.length
		// Use line 1 as placeholder since we don't have actual line numbers
		const hunkHeader = `@@ -1,${oldCount} +1,${newCount} @@`

		// Rebuild the diff lines
		const diffLines: string[] = []

		// Find common context at start
		let commonStart = 0
		while (
			commonStart < hunk.oldLines.length &&
			commonStart < hunk.newLines.length &&
			hunk.oldLines[commonStart] === hunk.newLines[commonStart]
		) {
			diffLines.push(' ' + hunk.oldLines[commonStart])
			commonStart++
		}

		// Find common context at end
		let commonEnd = 0
		while (
			commonEnd < hunk.oldLines.length - commonStart &&
			commonEnd < hunk.newLines.length - commonStart &&
			hunk.oldLines[hunk.oldLines.length - 1 - commonEnd] === hunk.newLines[hunk.newLines.length - 1 - commonEnd]
		) {
			commonEnd++
		}

		// Add deletions (middle part of old)
		for (let j = commonStart; j < hunk.oldLines.length - commonEnd; j++) {
			diffLines.push('-' + hunk.oldLines[j])
		}

		// Add additions (middle part of new)
		for (let j = commonStart; j < hunk.newLines.length - commonEnd; j++) {
			diffLines.push('+' + hunk.newLines[j])
		}

		// Add trailing context
		for (let j = hunk.oldLines.length - commonEnd; j < hunk.oldLines.length; j++) {
			diffLines.push(' ' + hunk.oldLines[j])
		}

		return hunkHeader + '\n' + diffLines.join('\n')
	})

	return header + '\n' + hunkStrings.join('\n')
}

export const ApplyPatchToolCallContent: FC<ApplyPatchToolCallContentProps> = ({
	toolInput,
	approvalStatus,
	toolResultContent,
	isFocused,
	isGroupItem,
	workingDir,
	onOpenFile,
}) => {
	const { theme } = useTheme()
	const { diffStyle } = useDiffStyle()
	const shikiTheme = themeToShiki[theme] ?? 'github-dark'

	const operations = useMemo(() => parseApplyPatch(toolInput.patch_text || ''), [toolInput.patch_text])

	const approvalStatusColor = getApprovalStatusColor(approvalStatus)
	const statusColor = isGroupItem && !approvalStatusColor ? 'text-[var(--terminal-accent)]' : approvalStatusColor
	const isDenied = approvalStatus === 'denied'

	// Get file paths for display
	const filePaths = operations.map((op) => op.filePath)
	const singleOperation = operations.length === 1 ? operations[0] : undefined
	const displayLabel = operations.length === 1 ? formatFilePath(filePaths[0], workingDir) : `${operations.length} files`

	return (
		<div className="space-y-2">
			<div className="flex items-start justify-between">
				<div className="flex-1">
					<div className="flex items-baseline gap-2">
						<span className={`text-sm font-semibold ${statusColor || ''}`}>Patch</span>
						{singleOperation ? (
							<OpenableFilename
								path={singleOperation.filePath}
								displayPath={displayLabel}
								onOpen={onOpenFile}
							/>
						) : (
							<span className="text-sm text-muted-foreground">{displayLabel}</span>
						)}
					</div>
				</div>
				<div className="ml-4">
					<StatusBadge status={approvalStatus} />
				</div>
			</div>

			{/* Render each operation */}
			<div className="mt-2 space-y-3">
				{operations.map((op, idx) => (
					<div key={idx} className="border rounded-md overflow-hidden">
						{/* File header for multi-file patches */}
						{operations.length > 1 && (
							<div className="px-3 py-1.5 bg-muted/50 border-b text-sm flex items-center gap-2">
								<span className="text-muted-foreground">
									{op.type === 'add' && '+ '}
									{op.type === 'delete' && '- '}
									{op.type === 'move' && '→ '}
								</span>
								<OpenableFilename
									path={op.filePath}
									displayPath={formatFilePath(op.filePath, workingDir)}
									onOpen={onOpenFile}
								/>
								{op.type === 'move' && op.targetPath && (
									<>
										<span className="text-muted-foreground">→</span>
										<OpenableFilename
											path={op.targetPath}
											displayPath={formatFilePath(op.targetPath, workingDir)}
											onOpen={onOpenFile}
										/>
									</>
								)}
							</div>
						)}

						{/* Diff content */}
						{op.type === 'add' && op.content !== undefined ? (
							<PatchDiff
								patch={generateUnifiedDiffForAdd(op.filePath, op.content)}
								style={diffThemeStyleOverrides}
								options={{
									theme: shikiTheme,
									diffStyle: diffStyle === 'split' ? 'split' : 'unified',
									diffIndicators: 'classic',
									disableFileHeader: true,
									overflow: 'wrap',
									unsafeCSS: diffLayoutUnsafeCSS,
								}}
							/>
						) : (op.type === 'update' || op.type === 'move') && op.hunks && op.hunks.length > 0 ? (
							<PatchDiff
								patch={generateUnifiedDiffForUpdate(op.targetPath ?? op.filePath, op.hunks)}
								style={diffThemeStyleOverrides}
								options={{
									theme: shikiTheme,
									diffStyle: diffStyle === 'split' ? 'split' : 'unified',
									diffIndicators: 'classic',
									disableFileHeader: true,
									overflow: 'wrap',
									unsafeCSS: diffLayoutUnsafeCSS,
								}}
							/>
						) : (
							// For delete or empty patches, show raw patch text
							<pre className="p-3 text-sm font-mono overflow-x-auto bg-muted/30">
								<code className="language-diff">{op.rawPatch}</code>
							</pre>
						)}
					</div>
				))}
			</div>

			{/* Keyboard hints */}
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

			{/* Error/denial message */}
			{isDenied && toolResultContent && (
				<div className="mt-1 text-sm text-[var(--terminal-error)] font-mono flex items-start gap-1">
					<span className="text-[var(--terminal-error)]/50">⎿</span>
					<span>{toolResultContent}</span>
				</div>
			)}
		</div>
	)
}
