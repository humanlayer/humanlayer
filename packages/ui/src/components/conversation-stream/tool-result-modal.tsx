'use client'

import type { FC, ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../dialog'
import { ScrollArea } from '../scroll-area'
import { DiffViewer } from './diff-viewer'
import { EventIcon } from './event-icon'
import { Badge } from '../badge'
import type {
	BashToolInput,
	ConversationEvent,
	EditToolInput,
	MultiEditToolInput,
	TaskToolInput,
	WebFetchToolInput,
	WriteToolInput,
} from './types'
import { formatFilePath, parseMcpToolName, parseMcpTextContent, parseExitCode, truncateText } from './utils/formatters'
import { AnsiText, hasAnsiCodes } from '../../lib/ansi-parser'

export interface ToolResultModalProps {
	/** The tool call event (contains tool name and input parameters) */
	toolCall: ConversationEvent | null
	/** The tool result event (contains output/result) */
	toolResult: ConversationEvent | null
	/** Working directory for relative file path display */
	workingDir?: string
	/** Callback when modal is closed */
	onClose: () => void
	/** Optional callback to render custom file links - if not provided, plain text is shown */
	renderFileLink?: (filePath: string, workingDir?: string) => ReactNode
	/** Optional callback when a file path is clicked (only used if renderFileLink is not provided) */
	onOpenFile?: (filePath: string) => void
	/** Optional footer content (e.g., keyboard hints) */
	footer?: ReactNode
}

/**
 * Pure modal component for displaying tool call details and results.
 * This is a controlled component - open state is determined by toolCall/toolResult being non-null.
 */
export const ToolResultModal: FC<ToolResultModalProps> = ({
	toolCall,
	toolResult,
	workingDir,
	onClose,
	renderFileLink,
	onOpenFile,
	footer,
}) => {
	const isOpen = !!(toolResult || toolCall)

	if (!isOpen) return null

	const bashExitCode = toolCall?.toolName === 'Bash' ? parseExitCode(toolResult?.toolResultContent) : null
	const isBashError = bashExitCode !== null && bashExitCode !== 0

	// Determine if this is a subagent task
	let isNamedSubagent = false
	if (toolCall?.toolName === 'Task' || toolCall?.toolName === 'Agent') {
		try {
			const agentInput = JSON.parse(toolCall.toolInputJson || '{}')
			isNamedSubagent = !!agentInput.subagent_type
		} catch {
			// Ignore parse errors
		}
	}

	// Helper to render file path - either as custom link or plain text
	const renderFilePath = (filePath: string) => {
		if (renderFileLink) {
			return renderFileLink(filePath, workingDir)
		}
		const displayPath = formatFilePath(filePath, workingDir)
		if (onOpenFile) {
			return (
				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation()
						onOpenFile(filePath)
					}}
					className="text-[var(--terminal-accent)] hover:underline cursor-pointer"
				>
					{displayPath}
				</button>
			)
		}
		return <span className="font-mono">{displayPath}</span>
	}

	return (
		<Dialog
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) {
					onClose()
				}
			}}
		>
			<DialogContent
				className="w-[90vw] max-w-[90vw] h-[85vh] p-0 sm:max-w-[90vw] flex flex-col overflow-hidden"
				onEscapeKeyDown={(e) => {
					// Let parent handle escape if needed
					e.preventDefault()
				}}
			>
				<DialogHeader className="px-4 py-3 border-b bg-background flex-none">
					<DialogTitle className="text-sm font-mono">
						<div className="flex items-center gap-2">
							{/* Tool icon */}
							<span className="text-accent">
								<EventIcon
									type="tool_call"
									toolName={toolCall?.toolName}
									isCompleted={toolCall?.isCompleted}
									isNamedSubagent={isNamedSubagent}
									size="md"
								/>
							</span>
							<span>
								{/* Show sub-agent type for Task tools */}
								{(() => {
									if ((toolCall?.toolName === 'Task' || toolCall?.toolName === 'Agent') && toolCall.toolInputJson) {
										try {
											const args = JSON.parse(toolCall.toolInputJson)
											if (args.subagent_type) {
												return `Sub-agent: ${args.subagent_type}`
											}
										} catch {
											// Ignore parse errors
										}
									}
									return toolCall?.toolName || 'Tool Result'
								})()}
								{!toolResult && toolCall && !toolCall.isCompleted && (
									<span className="text-xs text-muted-foreground ml-2">(in progress)</span>
								)}
							</span>
							{/* Show primary parameter */}
							{toolCall?.toolInputJson && (
								<span className="text-xs text-muted-foreground">
									{getToolPrimaryParam(toolCall, workingDir, renderFilePath)}
								</span>
							)}
						</div>
					</DialogTitle>
				</DialogHeader>

				<div className="flex-1 overflow-hidden">
					<ScrollArea className="h-full">
						<div className="px-4 py-4 space-y-4">
							{/* Tool Input Section */}
							{toolCall?.toolInputJson && renderToolInput(toolCall, workingDir, renderFilePath)}

							{/* Tool Result Section - only show if we have a result */}
							{toolResult && (
								<div>
									<div className="flex items-center gap-2 mb-2">
										<h3 className="text-sm font-medium text-muted-foreground">Result</h3>
										{isBashError && (
											<Badge
												variant="outline"
												className="text-[var(--terminal-error)] border-[var(--terminal-error)]/50 text-xs uppercase"
											>
												failed
											</Badge>
										)}
									</div>
									<pre className="font-mono text-sm whitespace-pre-wrap break-words">
										{(() => {
											const content = toolCall?.toolName?.startsWith('mcp__')
												? parseMcpTextContent(toolResult.toolResultContent)
												: toolResult.toolResultContent

											if (!content) return 'No content'

											// Render ANSI colors for Bash tool output. Claude emits "Bash"
											// (PascalCase) while CodeLayer/Codex emits "bash" (lowercase),
											// so match either casing.
											const isBashTool =
												toolCall?.toolName === 'Bash' || toolCall?.toolName === 'bash'
											if (isBashTool && hasAnsiCodes(content)) {
												return <AnsiText content={content} />
											}

											return content
										})()}
									</pre>
								</div>
							)}
						</div>
					</ScrollArea>
				</div>

				{footer && (
					<div className="px-4 py-2 border-t bg-muted/30 flex justify-between items-center flex-none">
						{footer}
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}

// Helper functions

function formatToolInput(inputJson: string | undefined): string {
	if (!inputJson) return 'No input'
	try {
		const parsed = JSON.parse(inputJson)
		return JSON.stringify(parsed, null, 2)
	} catch {
		return inputJson
	}
}

function getToolPrimaryParam(
	toolCall: ConversationEvent,
	workingDir?: string,
	renderFilePath?: (filePath: string) => ReactNode,
): ReactNode {
	if (!toolCall.toolInputJson) return ''

	try {
		const args = JSON.parse(toolCall.toolInputJson)

		// Special handling for Read tool to show file link
		if (toolCall.toolName === 'Read' && args.file_path && renderFilePath) {
			return renderFilePath(args.file_path)
		}

		// For all other tools, return the string version
		if ((toolCall.toolName === 'Task' || toolCall.toolName === 'Agent') && args.description) {
			return truncateText(args.description, 60)
		}
		if (toolCall.toolName === 'Read' && args.file_path) {
			return formatFilePath(args.file_path, workingDir)
		}
		if (toolCall.toolName === 'Bash' && args.command) {
			return truncateText(args.command, 60)
		}
		if (toolCall.toolName === 'Edit' && args.file_path) {
			return formatFilePath(args.file_path, workingDir)
		}
		if (toolCall.toolName === 'Write' && args.file_path) {
			return formatFilePath(args.file_path, workingDir)
		}
		if (toolCall.toolName === 'Grep' && args.pattern) {
			return args.pattern
		}
		if (toolCall.toolName === 'ExitPlanMode' && args.plan) {
			const firstLine = args.plan.split('\n')[0].trim()
			return truncateText(firstLine, 60)
		}
		if (toolCall.toolName === 'WebFetch' && args.url) {
			return truncateText(args.url, 60)
		}

		// For other tools, show the first string value
		const firstValue = Object.values(args).find((v) => typeof v === 'string')
		return firstValue ? truncateText(String(firstValue), 60) : ''
	} catch {
		return ''
	}
}

function renderToolInput(
	toolCall: ConversationEvent,
	workingDir?: string,
	renderFilePath?: (filePath: string) => ReactNode,
): ReactNode {
	if (!toolCall.toolInputJson) return null

	try {
		const args = JSON.parse(toolCall.toolInputJson)

		// Special rendering for MCP tools
		if (toolCall.toolName?.startsWith('mcp__')) {
			const { service, method } = parseMcpToolName(toolCall.toolName)

			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">Service:</span>{' '}
						<span className="font-bold">{service}</span>
					</div>
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">Method:</span>{' '}
						<span className="font-bold">{method}</span>
					</div>
					{Object.keys(args).length > 0 && (
						<div className="font-mono text-sm">
							<span className="text-muted-foreground">Parameters:</span>
							<pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
								{JSON.stringify(args, null, 2)}
							</pre>
						</div>
					)}
				</div>
			)
		}

		// Special rendering for Write tool
		if (toolCall.toolName === 'Write') {
			const writeArgs = args as WriteToolInput
			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">File:</span>{' '}
						{renderFilePath ? renderFilePath(writeArgs.file_path) : formatFilePath(writeArgs.file_path, workingDir)}
					</div>
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">Content:</span>
						<pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
							{writeArgs.content}
						</pre>
					</div>
				</div>
			)
		}

		// Special rendering for Edit tool
		if (toolCall.toolName === 'Edit') {
			const editArgs = args as EditToolInput
			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">File:</span>{' '}
						{renderFilePath ? renderFilePath(editArgs.file_path) : formatFilePath(editArgs.file_path, workingDir)}
					</div>
					<div className="mt-2">
						<DiffViewer
							oldContent={editArgs.old_string || ''}
							newContent={editArgs.new_string || ''}

							showFullFile={false}
						/>
					</div>
				</div>
			)
		}

		// Special rendering for MultiEdit tool
		if (toolCall.toolName === 'MultiEdit') {
			const multiEditArgs = args as MultiEditToolInput
			const edits = Array.isArray(multiEditArgs.edits) ? multiEditArgs.edits : []

			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">File:</span>{' '}
						{multiEditArgs.file_path &&
							(renderFilePath
								? renderFilePath(multiEditArgs.file_path)
								: formatFilePath(multiEditArgs.file_path, workingDir))}
					</div>
					<div className="font-mono text-sm mb-2">
						<span className="text-muted-foreground">{edits.length} edits</span>
					</div>
					<div className="mt-2 space-y-4">
						{edits.map((edit, index) => (
							<DiffViewer
								key={index}
								oldContent={edit.old_string || ''}
								newContent={edit.new_string || ''}
	
								showFullFile={false}
							/>
						))}
					</div>
				</div>
			)
		}

		// Special rendering for ExitPlanMode tool
		if (toolCall.toolName === 'ExitPlanMode') {
			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">Plan:</span>
						<pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">{args.plan}</pre>
					</div>
				</div>
			)
		}

		// Special rendering for Task tool (sub-agents)
		if ((toolCall.toolName === 'Task' || toolCall.toolName === 'Agent') && args.subagent_type) {
			const taskArgs = args as TaskToolInput
			return (
				<div className="space-y-3">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">Sub-agent Type:</span>{' '}
						<span className="font-bold text-accent">{taskArgs.subagent_type}</span>
					</div>
					{taskArgs.description && (
						<div className="font-mono text-sm">
							<span className="text-muted-foreground">Description:</span>{' '}
							<span className="italic">{taskArgs.description}</span>
						</div>
					)}
					{taskArgs.prompt && (
						<div className="font-mono text-sm">
							<div className="text-muted-foreground mb-1">Prompt:</div>
							<pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
								{taskArgs.prompt}
							</pre>
						</div>
					)}
					{/* Show other parameters if they exist */}
					{Object.keys(args).filter((k) => !['subagent_type', 'description', 'prompt'].includes(k)).length > 0 && (
						<div className="font-mono text-sm">
							<div className="text-muted-foreground mb-1">Additional Parameters:</div>
							<pre className="mt-1 whitespace-pre-wrap bg-muted/50 rounded-md p-3 break-words">
								{JSON.stringify(
									Object.fromEntries(
										Object.entries(args).filter(([k]) => !['subagent_type', 'description', 'prompt'].includes(k)),
									),
									null,
									2,
								)}
							</pre>
						</div>
					)}
				</div>
			)
		}

		// Special rendering for WebFetch tool
		if (toolCall.toolName === 'WebFetch') {
			const webFetchArgs = args as WebFetchToolInput
			return (
				<div className="space-y-2">
					<div className="font-mono text-sm">
						<span className="text-muted-foreground">URL:</span>{' '}
						<span className="font-bold">{webFetchArgs.url}</span>
					</div>
					{webFetchArgs.prompt && (
						<div className="font-mono text-sm">
							<span className="text-muted-foreground">Prompt:</span>{' '}
							<span className="italic">{webFetchArgs.prompt}</span>
						</div>
					)}
				</div>
			)
		}

		// Special rendering for Bash tool
		if (toolCall.toolName === 'Bash') {
			const bashArgs = args as BashToolInput
			return (
				<div className="space-y-3">
					<pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words">
						{formatToolInput(toolCall.toolInputJson)}
					</pre>
					{bashArgs.description && (
						<div className="font-mono text-sm">
							<span className="text-muted-foreground">Description:</span>{' '}
							<span className="italic">{bashArgs.description}</span>
						</div>
					)}
					<div className="font-mono text-xs">
						<span className="text-muted-foreground">Command:</span>
						<pre className="mt-1 whitespace-pre-wrap bg-[var(--terminal-bg-alt)] text-[var(--terminal-accent)] border border-[var(--terminal-border)] tracking-tight shadow-sm rounded-md px-3 py-2 break-words">
							{bashArgs.command}
						</pre>
					</div>
				</div>
			)
		}

		// Default JSON rendering for other tools
		return (
			<pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words">
				{formatToolInput(toolCall.toolInputJson)}
			</pre>
		)
	} catch {
		// Fallback to raw display if JSON parsing fails
		return (
			<pre className="font-mono text-sm whitespace-pre-wrap bg-muted/50 rounded-md p-4 break-words">
				{toolCall.toolInputJson}
			</pre>
		)
	}
}
