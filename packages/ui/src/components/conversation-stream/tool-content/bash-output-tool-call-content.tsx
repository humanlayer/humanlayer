import type { FC } from 'react'
import type { ToolCallContentProps } from '../types'

interface BashOutputToolInput {
	bash_id?: string
}

interface ParsedBashOutput {
	status?: string
	exitCode: number
	stdout?: string
	stderr?: string
	timestamp?: string
}

function parseToolResultContent(toolResultContent: string): ParsedBashOutput {
	// Wrap in a root element since XML requires one
	const wrapped = `<response>${toolResultContent}</response>`
	const parser = new DOMParser()
	const xmlDoc = parser.parseFromString(wrapped, 'text/xml')

	const status = xmlDoc.querySelector('status')?.textContent || undefined
	const exitCode = Number.parseInt(xmlDoc.querySelector('exit_code')?.textContent || '-10000', 10)
	const stdout = xmlDoc.querySelector('stdout')?.textContent || undefined
	const stderr = xmlDoc.querySelector('stderr')?.textContent || undefined
	const timestamp = xmlDoc.querySelector('timestamp')?.textContent || undefined

	return {
		status,
		exitCode,
		stdout,
		stderr,
		timestamp,
	}
}

/**
 * Component for displaying BashOutput tool calls.
 * Used to retrieve output from background bash shells.
 */
export const BashOutputToolCallContent: FC<ToolCallContentProps<BashOutputToolInput>> = ({
	toolInput,
	isCompleted,
	toolResultContent,
	isFocused,
}) => {
	const parsedToolResultContent = parseToolResultContent(toolResultContent || '')

	return (
		<div className="overflow-hidden text-sm">
			<div className="flex flex-col gap-1">
				<div className="flex items-baseline gap-2">
					<span className="text-sm font-semibold text-muted-foreground">Bash Output</span>
					<span className="text-muted-foreground/60 text-sm">{toolInput?.bash_id || 'No ID'}</span>
				</div>

				{isCompleted && toolResultContent && parsedToolResultContent.exitCode === 0 && (
					<div className="text-sm text-muted-foreground/60 truncate">
						<span className="text-muted-foreground/50">⎿</span>
						<span>
							{parsedToolResultContent.stdout && parsedToolResultContent.stdout.length > 100
								? `${parsedToolResultContent.stdout.substring(0, 100)}...`
								: parsedToolResultContent.stdout}

							{isFocused && (
								<span className="text-sm text-muted-foreground/50 ml-2">
									<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
								</span>
							)}
						</span>
					</div>
				)}

				{isCompleted && toolResultContent && parsedToolResultContent.exitCode !== 0 && (
					<div className="text-sm truncate text-destructive">
						<span className="text-muted-foreground/50">⎿</span>
						<span>
							{parsedToolResultContent.stderr && parsedToolResultContent.stderr.length > 100
								? `${parsedToolResultContent.stderr.substring(0, 100)}...`
								: parsedToolResultContent.stderr}
							{` (Exit Code: ${parsedToolResultContent.exitCode})`}
							{isFocused && (
								<span className="text-sm text-muted-foreground/50 ml-2">
									<kbd className="px-1 py-0.5 text-sm bg-muted/50 rounded">i</kbd> expand
								</span>
							)}
						</span>
					</div>
				)}
			</div>
		</div>
	)
}
