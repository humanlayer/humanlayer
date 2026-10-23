import { useCopyToClipboard } from '@uidotdev/usehooks'
import { MessageSquareShare } from 'lucide-react'
import { type FC, useCallback } from 'react'
import {
	formatAllThreadsForLlm,
	type MarkdownBlockContext,
	RESOLVED_COMMENTS_NOTE,
} from '../lib/comment-utils'
import { Button } from './button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from './dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

interface ThreadInput {
	markdownContext?: MarkdownBlockContext | null
	rootComment: {
		id: string
		contentText: string
		isResolved: boolean
		createdByUserId: string
	}
	replies: Array<{
		id: string
		contentText: string
		isResolved: boolean
		createdByUserId: string
	}>
}

export interface CommentsBulkActionsDropdownProps {
	/** Artifact filename for the wrapper tag */
	artifactFilename?: string
	/** Unresolved comment threads to act on */
	threads: ThreadInput[]
	/** User lookup for display names */
	userLookup?: Map<string, { displayName?: string }>
	/** Button size class */
	className?: string
	/** Called to append formatted comments to agent input */
	onAppendToAgentInput?: (text: string) => void
	/** Called to resolve all comments */
	onResolveAll?: () => void
}

export interface CommentsBulkActionsModel {
	threadCount: number
	copyForAgent: () => void
	sendToAgent?: () => void
	sendToAgentAndResolve?: () => void
	resolveAll?: () => void
}

export function useCommentsBulkActionsModel({
	artifactFilename,
	threads,
	userLookup,
	onAppendToAgentInput,
	onResolveAll,
}: CommentsBulkActionsDropdownProps): CommentsBulkActionsModel {
	const [, copyToClipboard] = useCopyToClipboard()

	const getFormattedComments = useCallback(
		() => formatAllThreadsForLlm({ artifactFilename, threads, userLookup }),
		[artifactFilename, threads, userLookup],
	)
	const copyForAgent = useCallback(() => {
		void copyToClipboard(getFormattedComments())
	}, [copyToClipboard, getFormattedComments])
	const sendToAgent = useCallback(() => {
		onAppendToAgentInput?.(getFormattedComments())
	}, [onAppendToAgentInput, getFormattedComments])
	const sendToAgentAndResolve = useCallback(() => {
		const formatted = getFormattedComments()
		const withNote = formatted.replace('</comments>', `\n\n${RESOLVED_COMMENTS_NOTE}\n</comments>`)
		onAppendToAgentInput?.(withNote)
		onResolveAll?.()
	}, [onAppendToAgentInput, getFormattedComments, onResolveAll])

	return {
		threadCount: threads.length,
		copyForAgent,
		sendToAgent: onAppendToAgentInput ? sendToAgent : undefined,
		sendToAgentAndResolve: onAppendToAgentInput ? sendToAgentAndResolve : undefined,
		resolveAll: onResolveAll,
	}
}

export function CommentsBulkActionsMenuItems({ model }: { model: CommentsBulkActionsModel }) {
	if (model.threadCount === 0) return <DropdownMenuItem disabled>No unresolved comments</DropdownMenuItem>

	return (
		<>
			<DropdownMenuItem onSelect={model.copyForAgent}>
				Copy {model.threadCount} comment{model.threadCount !== 1 ? 's' : ''} for Agent
			</DropdownMenuItem>
			{model.sendToAgent && model.sendToAgentAndResolve && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={model.sendToAgent}>Send all comments to agent</DropdownMenuItem>
					<DropdownMenuItem onSelect={model.sendToAgentAndResolve}>
						Send all comments to agent and resolve
					</DropdownMenuItem>
				</>
			)}
			{model.resolveAll && (
				<>
					<DropdownMenuSeparator />
					<DropdownMenuItem onSelect={model.resolveAll}>Resolve all comments</DropdownMenuItem>
				</>
			)}
		</>
	)
}

export function CommentsBulkActionsOverflowItem({ model }: { model: CommentsBulkActionsModel }) {
	if (model.threadCount === 0) return <DropdownMenuItem disabled>Comment actions</DropdownMenuItem>

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>Comment actions</DropdownMenuSubTrigger>
			<DropdownMenuSubContent>
				<CommentsBulkActionsMenuItems model={model} />
			</DropdownMenuSubContent>
		</DropdownMenuSub>
	)
}

export function CommentsBulkActionsDropdownView({
	model,
	className,
}: {
	model: CommentsBulkActionsModel
	className?: string
}) {
	if (model.threadCount === 0) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<Button
							variant="ghost"
							size="icon"
							className={className ?? 'h-6 w-6'}
							disabled
							aria-label="No unresolved comments"
						>
							<MessageSquareShare className="h-3 w-3" />
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>No unresolved comments</TooltipContent>
			</Tooltip>
		)
	}

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className={className ?? 'h-6 w-6'} aria-label="Comment actions">
							<MessageSquareShare className="h-3 w-3" />
						</Button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>Comment actions</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end">
				<CommentsBulkActionsMenuItems model={model} />
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

/**
 * Dropdown with bulk comment actions: copy for LLM, send to agent, resolve all.
 * When no threads, renders a disabled button with tooltip.
 */
export const CommentsBulkActionsDropdown: FC<CommentsBulkActionsDropdownProps> = ({
	artifactFilename,
	threads,
	userLookup,
	className,
	onAppendToAgentInput,
	onResolveAll,
}) => {
	const model = useCommentsBulkActionsModel({
		artifactFilename,
		threads,
		userLookup,
		className,
		onAppendToAgentInput,
		onResolveAll,
	})
	return <CommentsBulkActionsDropdownView model={model} className={className} />
}
