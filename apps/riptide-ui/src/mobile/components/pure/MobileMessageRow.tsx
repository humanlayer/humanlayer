import { parseSuggestions, type PermissionUpdate } from '@humanlayer/db/zodschemas/permission-update'
import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Button } from '@humanlayer/ui/components/button'
import {
	ApplyPatchToolCallContent,
	type ApplyPatchToolInput,
	AssistantMessageContent,
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
	LSToolCallContent,
	type LSToolInput,
	MCPToolCallContent,
	MultiEditToolCallContent,
	type MultiEditToolInput,
	NotebookEditToolCallContent,
	type NotebookEditToolInput,
	NotebookReadToolCallContent,
	type NotebookReadToolInput,
	parseMcpTextContent,
	parseMcpToolName,
	parseToolInput,
	ReadToolCallContent,
	type ReadToolInput,
	type SkillToolInput,
	TaskToolCallContent,
	type TaskToolInput,
	TodoWriteToolCallContent,
	type TodoWriteToolInput,
	UnknownMessageContent,
	UnknownToolCallContent,
	UserMessageContent,
	WebFetchToolCallContent,
	type WebFetchToolInput,
	WebSearchToolCallContent,
	type WebSearchToolInput,
	WriteToolCallContent,
	type WriteToolInput,
} from '@humanlayer/ui/components/conversation-stream'
import { RpiSkillToolCallContent } from '@humanlayer/ui/components/conversation-stream/tool-content/rpi-skill-tool-call-content'
import { getLabelColor } from '@humanlayer/ui/components/session-label-badge'
import { RPI_SKILL_BY_NAME } from '@humanlayer/ui/constants/rpi-skills'
import { cn } from '@humanlayer/ui/lib/utils'
import { AlertTriangle, ChevronDown, Loader2, MessageCircleX } from 'lucide-react'
import type { FC, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from 'react'

import { getMobileToolDisplayLabel, isThinkingEvent } from '@/utils/mobile-conversation-events'

export interface MobileMessageRowProps {
	// Mirror of ConversationEventRowProps (desktop-only ergonomics dropped):
	event: ConversationEvent
	toolResult?: ConversationEvent
	workingDir?: string
	fileSnapshots?: Record<string, string>
	onOpenFile?: (filePath: string) => void
	onApprove: (approvalId: string) => void
	onDeny: (approvalId: string) => void
	/** Approve while persisting the tool's "don't ask again" suggestions. */
	onApproveWithSuggestions: (approvalId: string, applied: PermissionUpdate[]) => void
	/** Hide Approve/Deny controls for viewers without approval permission
	 * (mirrors desktop's isApprovalActionsHidden). The pending indicator stays. */
	approvalActionsHidden?: boolean
	isApproving?: boolean
	/** True when THIS row's approval is currently in deny-feedback mode (composer open). */
	isDenying?: boolean
	/** Cancel deny-feedback mode. Always rendered as the Cancel button while denying, so required. */
	onCancelDeny: () => void
	showSenderName?: boolean

	// Mobile-only:
	isExpanded: boolean
	onToggleExpand: () => void
}

function deriveCollapsedPreview(event: ConversationEvent): string {
	if (event.eventType === 'tool_call') {
		const normalized = event.toolName?.toLowerCase().replace(/_/g, '')
		const input = parseToolInput<Record<string, unknown>>(event.toolInputJson)
		switch (normalized) {
			case 'bash': {
				const command = (input?.command as string | undefined) ?? ''
				return command.split('\n')[0] || 'bash'
			}
			case 'bashoutput':
				return 'bash output'
			case 'read':
			case 'write':
			case 'edit':
			case 'multiedit':
				return (input?.file_path as string | undefined) ?? event.toolName ?? ''
			case 'applypatch': {
				// ApplyPatch input is a raw patch body; surface the first touched file.
				const patchText = (input?.patch_text as string | undefined) ?? ''
				const fileLine = patchText.split('\n').find((line) => /^\*\*\* (Add|Update|Delete) File: /.test(line))
				return fileLine?.replace(/^\*\*\* (Add|Update|Delete) File: /, '') ?? 'apply patch'
			}
			case 'grep':
				return (input?.pattern as string | undefined) ?? 'grep'
			case 'glob':
				return (input?.pattern as string | undefined) ?? 'glob'
			case 'ls':
			case 'list':
				return (input?.path as string | undefined) ?? 'ls'
			case 'websearch':
				return (input?.query as string | undefined) ?? 'search'
			case 'webfetch':
				return (input?.url as string | undefined) ?? 'fetch'
			case 'todowrite': {
				const todos = input?.todos as unknown[] | undefined
				return `TODO (${todos?.length ?? 0})`
			}
			case 'exitplanmode':
				return 'Exit plan mode'
			case 'skill':
				return `/${(input?.skill as string | undefined) ?? 'skill'}`
			case 'notebookread':
			case 'notebookedit':
				return (input?.notebook_path as string | undefined) ?? 'notebook'
			case 'task':
			case 'agent':
				return (input?.description as string | undefined) ?? event.toolName ?? 'task'
			default:
				if (event.toolName?.startsWith('mcp__')) {
					const { method } = parseMcpToolName(event.toolName)
					return method || event.toolName
				}
				return event.toolName ?? 'tool'
		}
	}

	const content = event.content ?? ''
	if (content.startsWith('<thinking>')) {
		const end = content.indexOf('</thinking>')
		const body = end === -1 ? content.slice('<thinking>'.length) : content.slice('<thinking>'.length, end)
		return body.trim().split('\n')[0] ?? ''
	}
	return content.split('\n')[0] ?? ''
}

/**
 * Tool label shown next to the icon in the collapsed row.
 * Returns `null` for message events (user / assistant / thinking) — their
 * collapsed preview is just the content, no label.
 */
function deriveCollapsedLabel(event: ConversationEvent): string | null {
	if (event.eventType !== 'tool_call') return null
	return getMobileToolDisplayLabel(event)
}

function renderExpandedEventBody(
	event: ConversationEvent,
	toolResult: ConversationEvent | undefined,
	workingDir: string | undefined,
	fileSnapshots: Record<string, string> | undefined,
	onOpenFile: ((filePath: string) => void) | undefined,
): ReactNode {
	if (event.eventType === 'tool_call') {
		const toolResultContent = toolResult?.toolResultContent
		const normalized = event.toolName?.toLowerCase().replace(/_/g, '')
		// Suppress the inline NEEDS_APPROVAL badge that desktop tool-content components
		// render via StatusBadge — on mobile it eats horizontal space. The approval
		// signal is shown in the mobile row header + the warm row tint + the
		// Approve/Deny buttons at the bottom of the expanded row.
		const approvalStatus = event.approvalStatus === 'pending' ? undefined : event.approvalStatus

		switch (normalized) {
			case 'bash': {
				const bashInput = parseToolInput<BashToolInput>(event.toolInputJson)
				if (bashInput) {
					return (
						<BashToolCallContent
							toolInput={bashInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'bashoutput': {
				const bashOutputInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
				return (
					<BashOutputToolCallContent
						toolInput={bashOutputInput || {}}
						isCompleted={event.isCompleted}
						toolResultContent={toolResultContent}
					/>
				)
			}
			case 'read': {
				const readInput = parseToolInput<ReadToolInput>(event.toolInputJson)
				if (readInput) {
					return (
						<ReadToolCallContent
							toolInput={readInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
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
					return (
						<WriteToolCallContent
							toolInput={writeInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
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
					return (
						<EditToolCallContent
							toolInput={editInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
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
					return (
						<MultiEditToolCallContent
							toolInput={multiEditInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
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
					return (
						<ApplyPatchToolCallContent
							toolInput={applyPatchInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
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
					return (
						<GrepToolCallContent
							toolInput={grepInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'glob': {
				const globInput = parseToolInput<GlobToolInput>(event.toolInputJson)
				if (globInput) {
					return (
						<GlobToolCallContent
							toolInput={globInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'ls':
			case 'list': {
				const lsInput = parseToolInput<LSToolInput>(event.toolInputJson)
				if (lsInput) {
					return (
						<LSToolCallContent
							toolInput={lsInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'agent':
			case 'task': {
				const taskInput = parseToolInput<TaskToolInput>(event.toolInputJson)
				if (taskInput) {
					return (
						<TaskToolCallContent
							toolInput={taskInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'todowrite': {
				const todoInput = parseToolInput<TodoWriteToolInput>(event.toolInputJson)
				if (todoInput) {
					return (
						<TodoWriteToolCallContent
							toolInput={todoInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'websearch': {
				const webSearchInput = parseToolInput<WebSearchToolInput>(event.toolInputJson)
				if (webSearchInput) {
					return (
						<WebSearchToolCallContent
							toolInput={webSearchInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'webfetch': {
				const webFetchInput = parseToolInput<WebFetchToolInput>(event.toolInputJson)
				if (webFetchInput) {
					return (
						<WebFetchToolCallContent
							toolInput={webFetchInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'notebookread': {
				const notebookReadInput = parseToolInput<NotebookReadToolInput>(event.toolInputJson)
				if (notebookReadInput) {
					return (
						<NotebookReadToolCallContent
							toolInput={notebookReadInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'notebookedit': {
				const notebookEditInput = parseToolInput<NotebookEditToolInput>(event.toolInputJson)
				if (notebookEditInput) {
					return (
						<NotebookEditToolCallContent
							toolInput={notebookEditInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'exitplanmode': {
				const exitPlanInput = parseToolInput<ExitPlanModeToolInput>(event.toolInputJson)
				if (exitPlanInput) {
					return (
						<ExitPlanModeToolCallContent
							toolInput={exitPlanInput}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				break
			}
			case 'skill': {
				const skillInput = parseToolInput<SkillToolInput>(event.toolInputJson)
				if (skillInput?.skill) {
					const rpiSkill = RPI_SKILL_BY_NAME.get(skillInput.skill)
					if (rpiSkill) {
						return (
							<RpiSkillToolCallContent
								skillInput={skillInput}
								color={getLabelColor(rpiSkill.label.name)}
								isCompleted={event.isCompleted}
								toolResultContent={toolResultContent}
							/>
						)
					}
				}
				const unknownSkillInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
				return (
					<UnknownToolCallContent
						toolName={event.toolName}
						toolInput={unknownSkillInput || undefined}
						isCompleted={event.isCompleted}
						toolResultContent={toolResultContent}
					/>
				)
			}
			default: {
				if (event.toolName?.startsWith('mcp__')) {
					const { method } = parseMcpToolName(event.toolName)
					if (method === 'update_artifact_comments') {
						const resolveInput = parseToolInput<CommentResolveToolInput>(event.toolInputJson)
						if (resolveInput) {
							return (
								<CommentResolveToolCallContent
									toolInput={resolveInput}
									approvalStatus={approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
								/>
							)
						}
					} else if (method === 'reply_to_artifact_comment') {
						const replyInput = parseToolInput<CommentReplyToolInput>(event.toolInputJson)
						if (replyInput) {
							return (
								<CommentReplyToolCallContent
									toolInput={replyInput}
									approvalStatus={approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
								/>
							)
						}
					} else if (method === 'get_artifact_comments') {
						const getInput = parseToolInput<CommentGetToolInput>(event.toolInputJson)
						if (getInput) {
							return (
								<CommentGetToolCallContent
									toolInput={getInput}
									approvalStatus={approvalStatus}
									isCompleted={event.isCompleted}
									toolResultContent={parseMcpTextContent(toolResultContent)}
								/>
							)
						}
					}
					const mcpInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
					return (
						<MCPToolCallContent
							toolName={event.toolName}
							toolInput={mcpInput || {}}
							approvalStatus={approvalStatus}
							isCompleted={event.isCompleted}
							toolResultContent={toolResultContent}
						/>
					)
				}
				const unknownInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
				return (
					<UnknownToolCallContent
						toolName={event.toolName}
						toolInput={unknownInput || undefined}
						isCompleted={event.isCompleted}
						toolResultContent={toolResultContent}
					/>
				)
			}
		}
		// Tool-specific parse failure fallback
		const unknownInput = parseToolInput<Record<string, unknown>>(event.toolInputJson)
		return (
			<UnknownToolCallContent
				toolName={event.toolName}
				toolInput={unknownInput || undefined}
				isCompleted={event.isCompleted}
				toolResultContent={toolResult?.toolResultContent}
			/>
		)
	}

	if (event.role === 'user') {
		return <UserMessageContent content={event.content || ''} />
	}
	if (event.role === 'assistant') {
		return <AssistantMessageContent content={event.content || ''} isThinking={isThinkingEvent(event)} />
	}
	return <UnknownMessageContent />
}

/**
 * Expandable mobile row that mirrors the ConversationEventRow convention:
 * takes a single `event` and an optional paired `toolResult`, so a tool
 * call and its result render as a single row (never two).
 */
export const MobileMessageRow: FC<MobileMessageRowProps> = ({
	event,
	toolResult,
	workingDir,
	fileSnapshots,
	onOpenFile,
	onApprove,
	onDeny,
	onApproveWithSuggestions,
	approvalActionsHidden = false,
	isApproving = false,
	isDenying = false,
	onCancelDeny,
	showSenderName = false,
	isExpanded,
	onToggleExpand,
}) => {
	const isPendingApproval = event.approvalStatus === 'pending' && !!event.approvalId
	const approvableSuggestions = isPendingApproval
		? (parseSuggestions(event.suggestions) ?? []).filter((suggestion) => suggestion.type !== 'setMode')
		: []

	const handleApprove = (e: MouseEvent) => {
		e.stopPropagation()
		if (event.approvalId) onApprove(event.approvalId)
	}

	const handleDeny = (e: MouseEvent) => {
		e.stopPropagation()
		if (event.approvalId) onDeny(event.approvalId)
	}

	const handleApproveWithSuggestions = (e: MouseEvent) => {
		e.stopPropagation()
		if (event.approvalId) onApproveWithSuggestions(event.approvalId, approvableSuggestions)
	}

	const handleCancelDeny = (e: MouseEvent) => {
		e.stopPropagation()
		onCancelDeny()
	}

	// User messages render in full, right-aligned in a subtle tinted bubble — the
	// alignment + tint is the only affordance we need to tell "you" apart from the
	// assistant at a glance (no icon, no label). Assistant messages stay full-width,
	// plain, icon on the left. This is the whole user/assistant distinction on mobile.
	const isUserMessage = event.eventType !== 'tool_call' && event.role === 'user'
	if (isUserMessage) {
		return (
			<div className="flex justify-end px-4 py-2">
				{event.sender && (
					<Avatar className="mr-2 mt-1 h-6 w-6 shrink-0" title={event.sender.displayName}>
						<AvatarImage src={event.sender.profilePictureUrl} alt={event.sender.displayName} />
						<AvatarFallback className="text-[9px]">{event.sender.initials}</AvatarFallback>
					</Avatar>
				)}
				{/* Square corners (app-wide aesthetic is rounded-none). The inner
				    MarkdownRenderer adds a trailing `pb-4`; [&_.prose-terminal]:pb-0
				    kills it so the bubble's top/bottom padding read as even (prose
				    already zeroes the last child's margin). */}
				<div className="max-w-[85%] min-w-0 overflow-hidden bg-muted px-3.5 py-2.5 text-foreground [&_pre]:max-w-full [&_.prose-terminal]:pb-0">
					{showSenderName && event.sender && (
						<div className="mb-1 text-[10px] font-medium text-muted-foreground">
							{event.sender.displayName}
						</div>
					)}
					<UserMessageContent content={event.content || ''} />
				</div>
			</div>
		)
	}

	// Assistant messages render in full, always — no collapse affordance (part of the
	// mobile stream redesign). Everything else (errors and the tool rows rendered
	// inside a MobileToolGroup) stays tap-to-expand.
	const isAssistantMessage = event.eventType !== 'tool_call' && event.role === 'assistant' && !isThinkingEvent(event)
	const interactive = !isAssistantMessage
	const expanded = isAssistantMessage || isExpanded
	const handleKeyDown = (e: ReactKeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault()
			onToggleExpand()
		}
	}

	return (
		<div className={cn('bg-background', isPendingApproval && 'bg-[var(--terminal-warning)]/5')}>
			<div
				role={interactive ? 'button' : undefined}
				tabIndex={interactive ? 0 : undefined}
				onClick={interactive ? onToggleExpand : undefined}
				onKeyDown={interactive ? handleKeyDown : undefined}
				className={cn(
					'flex items-start gap-2 px-4 py-3 min-h-[48px]',
					interactive && 'cursor-pointer hover:bg-accent/5 active:bg-accent/10 transition-colors',
				)}
			>
				<div className="mt-0.5">
					<EventIcon
						type={event.eventType}
						role={event.role}
						toolName={event.toolName}
						isCompleted={event.isCompleted}
						isThinking={isThinkingEvent(event)}
						size="sm"
					/>
				</div>

				<div className="flex-1 min-w-0">
					{expanded ? (
						renderExpandedEventBody(event, toolResult, workingDir, fileSnapshots, onOpenFile)
					) : (
						<p className="text-sm text-foreground truncate">
							{(() => {
								const label = deriveCollapsedLabel(event)
								return label ? (
									<>
										<span className="font-medium">{label}</span>
										<span className="mx-1.5 text-muted-foreground/50">·</span>
										<span>{deriveCollapsedPreview(event)}</span>
									</>
								) : (
									deriveCollapsedPreview(event)
								)
							})()}
						</p>
					)}
				</div>

				{isPendingApproval && (
					<div
						className="shrink-0 flex items-center mt-0.5"
						aria-label="Needs approval"
						title="Needs approval"
					>
						<AlertTriangle className="h-4 w-4 text-[var(--terminal-warning)]" />
					</div>
				)}

				{interactive && (
					<div className="shrink-0 flex items-center mt-0.5">
						<ChevronDown
							className={cn(
								'h-4 w-4 text-muted-foreground transition-transform',
								!isExpanded && '-rotate-90',
							)}
						/>
					</div>
				)}
			</div>

			{expanded && isPendingApproval && !approvalActionsHidden && (
				<div className="flex flex-wrap gap-2 px-4 pb-3">
					{isDenying ? (
						<>
							<div className="flex w-full items-center gap-1.5 text-xs text-[var(--terminal-error)]">
								<MessageCircleX className="h-3.5 w-3.5 shrink-0" />
								Add feedback in the composer below, then tap Deny.
							</div>
							<Button
								size="sm"
								variant="outline"
								onClick={handleCancelDeny}
								className="flex-1 cursor-pointer"
							>
								Cancel
							</Button>
						</>
					) : (
						<>
							<Button
								size="sm"
								variant={isApproving ? 'outline' : 'default'}
								onClick={handleApprove}
								disabled={isApproving}
								className="flex-1 cursor-pointer"
							>
								{isApproving ? (
									<>
										<Loader2 className="w-3 h-3 mr-1 animate-spin" />
										Approving…
									</>
								) : (
									'Approve'
								)}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								onClick={handleDeny}
								disabled={isApproving}
								className="flex-1 cursor-pointer"
							>
								Deny
							</Button>
							{approvableSuggestions.length > 0 && (
								<Button
									size="sm"
									variant="outline"
									onClick={handleApproveWithSuggestions}
									disabled={isApproving}
									className="w-full cursor-pointer text-xs"
								>
									Approve &amp; don&apos;t ask again
								</Button>
							)}
						</>
					)}
				</div>
			)}
		</div>
	)
}
