import { cn } from '@humanlayer/ui/lib/utils'
import type { FC, ReactNode } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@humanlayer/ui/components/button'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { ApprovalWrapper } from './approval-wrapper'
import { EventIcon } from './event-icon'
import { AssistantMessageContent, UnknownMessageContent, UserMessageContent } from './message-content'
import {
	ApplyPatchToolCallContent,
	BashOutputToolCallContent,
	BashToolCallContent,
	CommentGetToolCallContent,
	type CommentGetToolInput,
	CommentReplyToolCallContent,
	type CommentReplyToolInput,
	CommentResolveToolCallContent,
	type CommentResolveToolInput,
	EditToolCallContent,
	ExitPlanModeToolCallContent,
	GlobToolCallContent,
	GrepToolCallContent,
	LSToolCallContent,
	MCPToolCallContent,
	MultiEditToolCallContent,
	NotebookEditToolCallContent,
	NotebookReadToolCallContent,
	ReadToolCallContent,
	TaskToolCallContent,
	TodoWriteToolCallContent,
	UnknownToolCallContent,
	WebFetchToolCallContent,
	WebSearchToolCallContent,
	WriteToolCallContent,
} from './tool-content'
import {
	type ApplyPatchToolInput,
	type BashToolInput,
	type ConversationEvent,
	type EditToolInput,
	type ExitPlanModeToolInput,
	type GlobToolInput,
	type GrepToolInput,
	type LSToolInput,
	type MultiEditToolInput,
	type NotebookEditToolInput,
	type NotebookReadToolInput,
	normalizeSkillToolInput,
	type ReadToolInput,
	type TaskToolInput,
	isAgentToolName,
	type TodoWriteToolInput,
	type WebFetchToolInput,
	type WebSearchToolInput,
	type WriteToolInput,
	parseToolInput,
} from './types'
import { RpiSkillToolCallContent } from './tool-content/rpi-skill-tool-call-content'
import { RPI_SKILL_BY_NAME } from '../../constants/rpi-skills'
import { getLabelColor } from '../session-label-badge'
import { parseMcpTextContent, parseMcpToolName } from './utils/formatters'

export interface ConversationEventRowProps {
	event: ConversationEvent
	toolResult?: ConversationEvent
	isFocused?: boolean
	isLast?: boolean
	isGroupItem?: boolean
	workingDir?: string
	fileSnapshots?: Record<string, string> // Map of file_path -> snapshot content

	// Focus management
	onFocusChange?: (eventId: string | null, source: 'mouse' | 'keyboard') => void
	shouldIgnoreMouseEvent?: () => boolean

	// Modal expansion
	onRequestModal?: (toolCall: ConversationEvent, toolResult?: ConversationEvent) => void

	// File operations
	onOpenFile?: (filePath: string) => void

	// Approval handlers
	onApprove?: (approvalId: string) => void
	onDeny?: (approvalId: string, reason: string) => void
	onStartDeny?: (approvalId: string) => void
	onCancelDeny?: () => void
	/** Called when DENY button is clicked (in denying mode, triggers form submission) */
	onSubmitDeny?: () => void
	isApproving?: boolean
	isDenying?: boolean
	/** Whether there's text in the denial feedback input (enables DENY button) */
	hasDenyFeedback?: boolean
	/** When true, hide approve/deny buttons but keep approval content visible */
	isApprovalActionsHidden?: boolean

	// Copy handler for message content
	onCopy?: (content: string) => void
}

export const ConversationEventRow: FC<ConversationEventRowProps> = ({
	event,
	toolResult,
	isFocused = false,
	isLast = false,
	isGroupItem = false,
	workingDir,
	fileSnapshots,
	onFocusChange,
	shouldIgnoreMouseEvent,
	onRequestModal,
	onOpenFile,
	onApprove,
	onDeny: _onDeny,
	onStartDeny,
	onCancelDeny,
	onSubmitDeny,
	isApproving = false,
	isDenying = false,
	hasDenyFeedback = false,
	isApprovalActionsHidden = false,
	onCopy,
}) => {
	const isThinking = Boolean(
		event.eventType === 'thinking' || (event.role === 'assistant' && event.content?.startsWith('<thinking>')),
	)

	// Determine if this is a subagent task
	let isNamedSubagent = false
	if (isAgentToolName(event.toolName)) {
		try {
			const agentInput = JSON.parse(event.toolInputJson || '{}')
			isNamedSubagent = !!agentInput.subagent_type
		} catch {
			// Ignore parse errors
		}
	}

	// Render content based on event type
	let content: ReactNode = null
	let skillColor: string | null = null

	if (event.eventType === 'tool_call') {
		const toolResultContent = toolResult?.toolResultContent
		// Normalize tool name for case-insensitive, underscore-insensitive matching
		// Claude Code uses PascalCase (Bash), CodeLayer uses lowercase/snake_case (bash, web_search)
		const normalizedToolName = event.toolName?.toLowerCase().replace(/_/g, '')

		switch (normalizedToolName) {
			case 'bash': {
				const bashInput = parseToolInput<BashToolInput>(event.toolInputJson)
				if (bashInput) {
					content = (
						<BashToolCallContent
							toolInput={bashInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'applypatch': {
				const applyPatchInput = parseToolInput<ApplyPatchToolInput>(event.toolInputJson)
				if (applyPatchInput) {
					content = (
						<ApplyPatchToolCallContent
							toolInput={applyPatchInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
							workingDir={workingDir}
							onOpenFile={onOpenFile}
						/>
					)
				}
				break
			}

			case 'bashoutput': {
				const bashOutputInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
				content = (
					<BashOutputToolCallContent
						toolInput={bashOutputInput || {}}
						isCompleted={event.isCompleted}
						toolResultContent={toolResultContent}
						isFocused={isFocused}
						isGroupItem={isGroupItem}
					/>
				)
				break
			}

			case 'read': {
				const readInput = parseToolInput<ReadToolInput>(event.toolInputJson)
				if (readInput) {
					content = (
						<ReadToolCallContent
							toolInput={readInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
							workingDir={workingDir}
							onOpenFile={onOpenFile}
						/>
					)
				}
				break
			}

			case 'write': {
				const writeInput = parseToolInput<WriteToolInput>(event.toolInputJson)
				if (writeInput) {
					content = (
						<WriteToolCallContent
							toolInput={writeInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
							workingDir={workingDir}
							fileSnapshot={fileSnapshots?.[writeInput.file_path]}
							onOpenFile={onOpenFile}
						/>
					)
				}
				break
			}

			case 'edit': {
				const editInput = parseToolInput<EditToolInput>(event.toolInputJson)
				if (editInput) {
					content = (
						<EditToolCallContent
							toolInput={editInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
							workingDir={workingDir}
							onOpenFile={onOpenFile}
						/>
					)
				}
				break
			}

			case 'multiedit': {
				const multiEditInput = parseToolInput<MultiEditToolInput>(event.toolInputJson)
				if (multiEditInput) {
					content = (
						<MultiEditToolCallContent
							toolInput={multiEditInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
							workingDir={workingDir}
							onOpenFile={onOpenFile}
						/>
					)
				}
				break
			}

			case 'grep': {
				const grepInput = parseToolInput<GrepToolInput>(event.toolInputJson)
				if (grepInput) {
					content = (
						<GrepToolCallContent
							toolInput={grepInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'glob': {
				const globInput = parseToolInput<GlobToolInput>(event.toolInputJson)
				if (globInput) {
					content = (
						<GlobToolCallContent
							toolInput={globInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'ls':
			case 'list': {
				const lsInput = parseToolInput<LSToolInput>(event.toolInputJson)
				if (lsInput) {
					content = (
						<LSToolCallContent
							toolInput={lsInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'agent':
			case 'task': {
				const agentInput = parseToolInput<TaskToolInput>(event.toolInputJson)
				if (agentInput) {
					content = (
						<TaskToolCallContent
							toolInput={agentInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'todowrite': {
				const todoInput = parseToolInput<TodoWriteToolInput>(event.toolInputJson)
				if (todoInput) {
					content = (
						<TodoWriteToolCallContent
							toolInput={todoInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'websearch': {
				const webSearchInput = parseToolInput<WebSearchToolInput>(event.toolInputJson)
				if (webSearchInput) {
					content = (
						<WebSearchToolCallContent
							toolInput={webSearchInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'webfetch': {
				const webFetchInput = parseToolInput<WebFetchToolInput>(event.toolInputJson)
				if (webFetchInput) {
					content = (
						<WebFetchToolCallContent
							toolInput={webFetchInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'notebookread': {
				const notebookReadInput = parseToolInput<NotebookReadToolInput>(event.toolInputJson)
				if (notebookReadInput) {
					content = (
						<NotebookReadToolCallContent
							toolInput={notebookReadInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'notebookedit': {
				const notebookEditInput = parseToolInput<NotebookEditToolInput>(event.toolInputJson)
				if (notebookEditInput) {
					content = (
						<NotebookEditToolCallContent
							toolInput={notebookEditInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'exitplanmode': {
				const exitPlanInput = parseToolInput<ExitPlanModeToolInput>(event.toolInputJson)
				if (exitPlanInput) {
					content = (
						<ExitPlanModeToolCallContent
							toolInput={exitPlanInput}
							approvalStatus={event.approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isGroupItem={isGroupItem}
						/>
					)
				}
				break
			}

			case 'skill': {
				const skillInput = normalizeSkillToolInput(parseToolInput<unknown>(event.toolInputJson))
				if (skillInput) {
					const rpiSkill = RPI_SKILL_BY_NAME.get(skillInput.skill)
					if (rpiSkill) {
						skillColor = getLabelColor(rpiSkill.label.name)
						content = (
							<RpiSkillToolCallContent
								skillInput={skillInput}
								color={skillColor}
								isCompleted={event.isCompleted}
								isFocused={isFocused}
								isGroupItem={isGroupItem}
								toolResultContent={toolResultContent}
							/>
						)
						break
					}
				}
				// Non-RPI or unparseable: fall through to unknown
				const unknownSkillInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
				content = (
					<UnknownToolCallContent
						toolName={event.toolName}
						toolInput={unknownSkillInput || undefined}
						isCompleted={event.isCompleted}
						toolResultContent={toolResultContent}
						isFocused={isFocused}
						isGroupItem={isGroupItem}
					/>
				)
				break
			}

			default: {
				// Handle MCP tools and unknown tools
				if (event.toolName?.startsWith('mcp__')) {
					const { method } = parseMcpToolName(event.toolName)
					if (method === 'update_artifact_comments') {
						const resolveInput = parseToolInput<CommentResolveToolInput>(event.toolInputJson)
						if (resolveInput) {
							content = (
								<CommentResolveToolCallContent
									toolInput={resolveInput}
									approvalStatus={event.approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
									isFocused={isFocused}
									isGroupItem={isGroupItem}
								/>
							)
						}
					} else if (method === 'reply_to_artifact_comment') {
						const replyInput = parseToolInput<CommentReplyToolInput>(event.toolInputJson)
						if (replyInput) {
							content = (
								<CommentReplyToolCallContent
									toolInput={replyInput}
									approvalStatus={event.approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
									isFocused={isFocused}
									isGroupItem={isGroupItem}
								/>
							)
						}
					} else if (method === 'get_artifact_comments') {
						const getInput = parseToolInput<CommentGetToolInput>(event.toolInputJson)
						if (getInput) {
							content = (
								<CommentGetToolCallContent
									toolInput={getInput}
									approvalStatus={event.approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
									isFocused={isFocused}
									isGroupItem={isGroupItem}
								/>
							)
						}
					}

					// Fall through to generic MCP renderer if no specific renderer matched
					if (!content) {
						const mcpInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
						content = (
							<MCPToolCallContent
								toolName={event.toolName}
								toolInput={mcpInput || {}}
								approvalStatus={event.approvalStatus}
								isCompleted={event.isCompleted}
								toolResultContent={toolResultContent}
								isFocused={isFocused}
								isGroupItem={isGroupItem}
							/>
						)
					}
				} else {
					const unknownInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
					content = (
						<UnknownToolCallContent
							toolName={event.toolName}
							toolInput={unknownInput || undefined}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
							isFocused={isFocused}
							isGroupItem={isGroupItem}
						/>
					)
				}
			}
		}
	} else if (event.role === 'user') {
		content = <UserMessageContent content={event.content || ''} />
	} else if (event.role === 'assistant') {
		content = <AssistantMessageContent content={event.content || ''} isThinking={isThinking} />
	} else {
		content = <UnknownMessageContent />
	}

	// Wrap in approval UI if pending
	const needsApproval = event.approvalStatus === 'pending' && event.approvalId && onApprove && onStartDeny

	if (needsApproval) {
		content = (
			<ApprovalWrapper
				approvalStatus={event.approvalStatus}
				isActionsHidden={isApprovalActionsHidden}
				onApprove={() => onApprove(event.approvalId!)}
				onStartDeny={() => onStartDeny(event.approvalId!)}
				onCancelDeny={onCancelDeny}
				onSubmitDeny={onSubmitDeny}
				isApproving={isApproving}
				isDenying={isDenying}
				hasDenyFeedback={hasDenyFeedback}
			>
				{content}
			</ApprovalWrapper>
		)
	}

	// Container classes
	const containerClasses = cn(
		'group p-4 transition-colors duration-200 border-l-2',
		event.eventType === 'tool_call' && onRequestModal && 'cursor-pointer',
		isFocused
			? 'border-l-[var(--terminal-accent)] bg-accent/10'
			: skillColor
				? ''
				: 'border-l-transparent',
		!isLast && 'border-b',
		isGroupItem && 'p-2 pl-4 border-b-0',
	)

	const containerStyle =
		!isFocused && skillColor
			? {
					borderLeftColor: skillColor,
					backgroundColor: `color-mix(in srgb, ${skillColor} 15%, transparent)`,
				}
			: undefined

	const handleClick = () => {
		if (event.eventType === 'tool_call' && onRequestModal) {
			onRequestModal(event, toolResult)
		}
	}

	const handleMouseEnter = () => {
		if (shouldIgnoreMouseEvent?.()) return
		onFocusChange?.(event.id, 'mouse')
	}

	const handleMouseLeave = () => {
		if (shouldIgnoreMouseEvent?.()) return
		onFocusChange?.(null, 'mouse')
	}

	return (
		<div
			className={containerClasses}
			style={containerStyle}
			data-event-id={event.id}
			onClick={handleClick}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<div className="flex items-start gap-4">
				{/* Left side: Icon and content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2">
						<span
							className={cn(
								'text-sm align-middle relative top-[1px]',
								isThinking ? 'text-muted-foreground' : 'text-accent',
							)}
						>
							<EventIcon
								type={event.eventType}
								role={event.role}
								toolName={event.toolName}
								isCompleted={event.isCompleted}
								isThinking={isThinking}
								isNamedSubagent={isNamedSubagent}
								size="md"
								skillColor={skillColor ?? undefined}
							/>
						</span>
						<div className="flex-1 min-w-0">
							{content}
						</div>
					</div>
				</div>

				{/* Right side: Copy button (for messages) and Timestamp */}
				<div className="flex items-center gap-2 flex-shrink-0">
					{/* Show copy button only for user/assistant messages with content */}
					{event.eventType === 'message' &&
						(event.role === 'user' || event.role === 'assistant') &&
						event.content &&
						onCopy && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
										onClick={(e) => {
											e.stopPropagation()
											onCopy(event.content!)
										}}
									>
										<Copy className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									<span>Copy message</span>
									<KeyboardShortcut size="xs">y</KeyboardShortcut>
								</TooltipContent>
							</Tooltip>
						)}
					<span className="text-xs text-muted-foreground/60">
						{event.createdAt && new Date(event.createdAt).toLocaleTimeString()}
					</span>
				</div>
			</div>
		</div>
	)
}
