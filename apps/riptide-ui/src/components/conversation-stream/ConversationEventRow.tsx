import type { NextStepSuggestion } from '@humanlayer/db/zodschemas/next-step'
import type { PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { Button } from '@humanlayer/ui/components/button'
import {
	ApplyPatchToolCallContent,
	type ApplyPatchToolInput,
	ApprovalWrapper,
	BashOutputToolCallContent,
	BashToolCallContent,
	type BashToolInput,
	CommentGetToolCallContent,
	type CommentGetToolInput,
	CommentReplyToolCallContent,
	type CommentReplyToolInput,
	CommentResolveToolCallContent,
	type CommentResolveToolInput,
	type ConversationEvent,
	EditToolCallContent,
	type EditToolInput,
	EventIcon,
	ExitPlanModeToolCallContent,
	type ExitPlanModeToolInput,
	GlobToolCallContent,
	type GlobToolInput,
	GrepToolCallContent,
	type GrepToolInput,
	isAgentToolName,
	LSToolCallContent,
	type LSToolInput,
	MCPToolCallContent,
	MultiEditToolCallContent,
	type MultiEditToolInput,
	NotebookEditToolCallContent,
	type NotebookEditToolInput,
	NotebookReadToolCallContent,
	type NotebookReadToolInput,
	normalizeSkillToolInput,
	parseMcpTextContent,
	parseMcpToolName,
	parseToolInput,
	ReadToolCallContent,
	type ReadToolInput,
	TaskToolCallContent,
	type TaskToolInput,
	TodoWriteToolCallContent,
	type TodoWriteToolInput,
	UnknownMessageContent,
	UnknownToolCallContent,
	WebFetchToolCallContent,
	type WebFetchToolInput,
	WebSearchToolCallContent,
	type WebSearchToolInput,
	WriteToolCallContent,
	type WriteToolInput,
} from '@humanlayer/ui/components/conversation-stream'
import { RpiSkillToolCallContent } from '@humanlayer/ui/components/conversation-stream/tool-content/rpi-skill-tool-call-content'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { getLabelColor } from '@humanlayer/ui/components/session-label-badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { RPI_SKILL_BY_NAME } from '@humanlayer/ui/constants/rpi-skills'
import { formatCompactRelativeTime, formatLocalAbsoluteTime } from '@humanlayer/ui/lib/time-format'
import { cn } from '@humanlayer/ui/lib/utils'
import { Copy, Eye, Share2, Split } from 'lucide-react'
import type { FC, ReactNode } from 'react'

import { useFocusStore } from '@/hooks/stores/focusStore'
import { isLocalCommandMessage } from '@/utils/sidebar-transforms'

import { AssistantMessageContent } from './AssistantMessageContent'
import { NextStepButton } from './NextStepButton'
import { UserMessageContent } from './UserMessageContent'

export interface ConversationEventRowProps {
	event: ConversationEvent
	toolResult?: ConversationEvent
	isFocused?: boolean
	isGroupItem?: boolean
	workingDir?: string
	fileSnapshots?: Record<string, string> // Map of file_path -> snapshot content

	// Focus management
	onFocusChange: (eventId: string | null, source: 'mouse' | 'keyboard') => void
	shouldIgnoreMouseEvent: () => boolean

	// Modal expansion
	onRequestModal?: (toolCall: ConversationEvent, toolResult?: ConversationEvent) => void

	// File operations
	onOpenFile?: (filePath: string) => void

	// Approval handlers
	onApprove?: (approvalId: string) => Promise<void>
	onApproveWithSuggestions?: (approvalId: string, applied: PermissionUpdate[]) => Promise<void>
	onDeny?: (approvalId: string, reason: string) => Promise<void>
	onStartDeny?: (approvalId: string) => void
	onCancelDeny?: () => void
	/** Called when DENY button is clicked (in denying mode, triggers form submission) */
	onSubmitDeny?: () => Promise<void>
	isApproving?: boolean
	isDenying?: boolean
	/** Whether there's text in the denial feedback input (enables DENY button) */
	hasDenyFeedback?: boolean

	// Copy handler for message content
	onCopy?: (content: string) => void

	// Fork handler for user messages
	onForkFromMessage?: (eventId: string) => void

	// Next step handler
	onProceedToNextStep?: (eventId: string, suggestion: NextStepSuggestion) => void
	/** When true, hide the next step button but keep assistant content visible */
	isNextStepHidden?: boolean
	/** Override the next step button variant */
	nextStepVariant?: 'loud-success-cta' | 'outline'
	/** Override the next step button label text */
	nextStepLabelOverride?: string
	/** When true, render the next step button in a disabled state */
	nextStepDisabled?: boolean

	/** When true, hide approve/deny buttons but keep approval content visible */
	isApprovalActionsHidden?: boolean
	/** Open the current artifact created by this completed tool call. */
	onViewArtifact?: () => void
	/** Open sharing for an eligible design artifact created by this tool call. */
	onShareArtifact?: () => void
	/** Select the row's stream or pinned-overlay presentation. */
	presentation?: 'stream' | 'pinned-user-message'
	/** Navigate from the pinned copy to its source row. */
	onPinnedUserMessageClick?: () => void
}

function ArtifactCreationActions({
	children,
	eventId,
	onViewArtifact,
	onShareArtifact,
}: {
	children: ReactNode
	eventId: string
	onViewArtifact?: () => void
	onShareArtifact?: () => void
}) {
	if (!onViewArtifact) return children

	return (
		<div className="flex-1">
			{children}
			<div className="mt-3 flex gap-2" data-artifact-actions={eventId}>
				<Button
					variant="outline"
					className="h-auto px-2 py-0.5 text-xs"
					onClick={(clickEvent) => {
						clickEvent.stopPropagation()
						onViewArtifact()
					}}
				>
					<Eye className="mr-1 h-3 w-3" />
					View artifact
				</Button>
				{onShareArtifact && (
					<Button
						variant="outline"
						className="h-auto px-2 py-0.5 text-xs"
						onClick={(clickEvent) => {
							clickEvent.stopPropagation()
							onShareArtifact()
						}}
					>
						<Share2 className="mr-1 h-3 w-3" />
						Share artifact
					</Button>
				)}
			</div>
		</div>
	)
}

export const ConversationEventRow: FC<ConversationEventRowProps> = ({
	event,
	toolResult,
	isFocused = false,
	isGroupItem = false,
	workingDir,
	fileSnapshots,
	onFocusChange,
	shouldIgnoreMouseEvent,
	onRequestModal,
	onOpenFile,
	onApprove,
	onApproveWithSuggestions,
	onDeny: _onDeny,
	onStartDeny,
	onCancelDeny,
	onSubmitDeny,
	isApproving = false,
	isDenying = false,
	hasDenyFeedback = false,
	onCopy,
	onForkFromMessage,
	onProceedToNextStep,
	isNextStepHidden = false,
	nextStepVariant,
	nextStepLabelOverride,
	nextStepDisabled,
	isApprovalActionsHidden = false,
	onViewArtifact,
	onShareArtifact,
	presentation = 'stream',
	onPinnedUserMessageClick,
}) => {
	const isPinnedUserMessage = presentation === 'pinned-user-message'
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
		content = (
			<UserMessageContent content={event.content || ''} sender={event.sender} truncate={isPinnedUserMessage} />
		)
	} else if (event.role === 'assistant') {
		// Wrap assistant message content with optional NextStepButton
		const assistantContent = <AssistantMessageContent content={event.content || ''} isThinking={isThinking} />

		if (
			event.nextStepSuggestion?.extraction.type === 'next_step_found' &&
			onProceedToNextStep &&
			!isNextStepHidden
		) {
			const nextStepSuggestion = event.nextStepSuggestion
			content = (
				<div className="flex-1">
					{assistantContent}
					<NextStepButton
						suggestion={nextStepSuggestion}
						eventId={event.id}
						onProceed={() => onProceedToNextStep(event.id, nextStepSuggestion)}
						isFocused={isFocused}
						variant={nextStepVariant}
						labelOverride={nextStepLabelOverride}
						disabled={nextStepDisabled}
					/>
				</div>
			)
		} else {
			content = assistantContent
		}
	} else {
		content = <UnknownMessageContent />
	}

	content = (
		<ArtifactCreationActions eventId={event.id} onViewArtifact={onViewArtifact} onShareArtifact={onShareArtifact}>
			{content}
		</ArtifactCreationActions>
	)

	// Wrap in approval UI if pending
	const approvalId = event.approvalId

	if (event.approvalStatus === 'pending' && approvalId && onApprove && onStartDeny) {
		content = (
			<ApprovalWrapper
				approvalStatus={event.approvalStatus}
				onApprove={() => void onApprove(approvalId)}
				onStartDeny={() => onStartDeny(approvalId)}
				onCancelDeny={onCancelDeny}
				onSubmitDeny={onSubmitDeny ? () => void onSubmitDeny() : undefined}
				isApproving={isApproving}
				isDenying={isDenying}
				hasDenyFeedback={hasDenyFeedback}
				isActionsHidden={isApprovalActionsHidden}
				suggestions={event.suggestions}
				onApproveWithSuggestions={
					onApproveWithSuggestions
						? (applied) => void onApproveWithSuggestions(approvalId, applied)
						: undefined
				}
			>
				{content}
			</ApprovalWrapper>
		)
	}

	// Role tint instead of row separators: user messages get a faint contrasting
	// background; every other row (assistant, tools, thinking, …) stays plain.
	const isUserMessage = event.eventType === 'message' && event.role === 'user'
	// While the prompt composer's editor owns keyboard focus, the focused row
	// keeps its highlight but drops the accent left bar.
	const isEditorFocused = useFocusStore((s) => s.isEditorFocused)
	const rowClasses = cn(
		'group p-4 transition-colors duration-200 border-l-2 relative',
		event.eventType === 'tool_call' && onRequestModal && 'cursor-pointer',
		isPinnedUserMessage && 'cursor-pointer',
		isUserMessage && 'bg-accent/10',
		isFocused
			? cn('bg-accent/5', isEditorFocused ? 'border-l-transparent' : 'border-l-[var(--terminal-accent)]')
			: skillColor
				? ''
				: 'border-l-transparent',
		isGroupItem && 'p-2 pl-4',
	)

	const containerClasses = cn(
		isGroupItem &&
			'relative pl-6 before:absolute before:left-6 before:top-0 before:bottom-0 before:border-l-2 before:border-muted/20',
	)

	const containerStyle =
		!isFocused && skillColor
			? {
					borderLeftColor: skillColor,
					backgroundColor: `color-mix(in srgb, ${skillColor} 15%, transparent)`,
				}
			: undefined

	const handleClick = () => {
		if (isPinnedUserMessage) {
			onPinnedUserMessageClick?.()
			return
		}
		if (event.eventType === 'tool_call' && onRequestModal) {
			onRequestModal(event, toolResult)
		}
	}

	const handleMouseEnter = () => {
		if (shouldIgnoreMouseEvent()) return
		onFocusChange(event.id, 'mouse')
	}

	const handleMouseLeave = () => {
		if (shouldIgnoreMouseEvent()) return
		onFocusChange(null, 'mouse')
	}

	const isClickable = isPinnedUserMessage || (event.eventType === 'tool_call' && !!onRequestModal)

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault()
			handleClick()
		}
	}

	const row = (
		<div
			className={rowClasses}
			style={containerStyle}
			data-event-id={event.id}
			role={isClickable ? 'button' : undefined}
			tabIndex={isClickable ? 0 : undefined}
			onClick={isClickable ? handleClick : undefined}
			onKeyDown={isClickable ? handleKeyDown : undefined}
			onMouseEnter={handleMouseEnter}
			onMouseLeave={handleMouseLeave}
		>
			<div className="flex items-start gap-4">
				{/* Left side: Icon and content */}
				<div className="flex-1 min-w-0">
					<div className="flex items-baseline gap-2">
						{!(event.role === 'user' && event.eventType === 'message' && event.sender) && (
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
						)}
						<div className="flex-1 min-w-0">{content}</div>
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
											onCopy(event.content ?? '')
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
					{/* Show fork button only for user messages (exclude local-command-stdout) */}
					{event.eventType === 'message' &&
						event.role === 'user' &&
						onForkFromMessage &&
						!isLocalCommandMessage(event.content) && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
										onClick={(e) => {
											e.stopPropagation()
											onForkFromMessage(event.id)
										}}
									>
										<Split className="w-3 h-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="flex items-center gap-1.5">
									<span>Fork from here</span>
									<KeyboardShortcut size="xs">⌘+Y</KeyboardShortcut>
								</TooltipContent>
							</Tooltip>
						)}
					{event.createdAt && (
						<Tooltip>
							<TooltipTrigger asChild>
								<span className="cursor-help text-xs text-muted-foreground/60">
									{formatCompactRelativeTime(event.createdAt)}
								</span>
							</TooltipTrigger>
							<TooltipContent>{formatLocalAbsoluteTime(event.createdAt)}</TooltipContent>
						</Tooltip>
					)}
				</div>
			</div>
		</div>
	)

	if (isGroupItem) {
		return <div className={containerClasses}>{row}</div>
	}

	return row
}
