import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import { Badge } from '@humanlayer/ui/components/badge'
import { Button } from '@humanlayer/ui/components/button'
import type { ConversationSender } from '@humanlayer/ui/components/conversation-stream'
import { Textarea } from '@humanlayer/ui/components/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { cn } from '@humanlayer/ui/lib/utils'
import { useCopyToClipboard } from '@uidotdev/usehooks'
import { Check, Clock, Copy, Pencil, Send, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

interface QueuedMessageBubbleProps {
	id: string
	content: string
	createdAt: bigint
	capabilities: QueuedMessageActionCapabilities
	onDelete: (messageId: string) => void
	onSendNow: (messageId: string) => void
	onEdit: (messageId: string, content: string) => void
	sender?: ConversationSender
	showSenderName: boolean
}

export interface QueuedMessageActionCapabilities {
	canDelete: boolean
	canSendNow: boolean
	canEdit: boolean
}

export function QueuedMessageBubble({
	id,
	content,
	capabilities,
	onDelete,
	onSendNow,
	onEdit,
	sender,
	showSenderName,
}: QueuedMessageBubbleProps) {
	const [isExpanded, setIsExpanded] = useState(false)
	const [isClamped, setIsClamped] = useState(false)
	const [isEditing, setIsEditing] = useState(false)
	// draftContent is always seeded from `content` when editing starts (see startEditing),
	// so the initial value is irrelevant — use '' to avoid derived-state from props.
	const [draftContent, setDraftContent] = useState('')
	const [, copyToClipboard] = useCopyToClipboard()
	const contentRef = useRef<HTMLParagraphElement>(null)

	const handleCopy = () => {
		void copyToClipboard(content)
		toast.success('Copied to clipboard')
	}

	const measureContentOverflow = (el: HTMLParagraphElement | null) => {
		;(contentRef as React.MutableRefObject<HTMLParagraphElement | null>).current = el
		if (el) {
			setIsClamped(el.scrollHeight > el.clientHeight)
		}
	}

	const startEditing = () => {
		setDraftContent(content)
		setIsEditing(true)
	}

	const cancelEditing = () => {
		setIsEditing(false)
		setDraftContent(content)
	}

	const saveEdit = () => {
		const trimmed = draftContent.trim()
		if (!trimmed) return
		setIsEditing(false)
		if (trimmed !== content) {
			onEdit(id, trimmed)
		}
	}

	return (
		<div className="group flex items-start gap-2 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2">
			{sender ? (
				<Avatar className="mt-0.5 h-5 w-5 shrink-0" title={sender.displayName}>
					<AvatarImage src={sender.profilePictureUrl} alt={sender.displayName} />
					<AvatarFallback className="text-[9px]">{sender.initials}</AvatarFallback>
				</Avatar>
			) : (
				<Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
			)}
			<div className="min-w-0 flex-1">
				{showSenderName && sender && (
					<div
						className="mb-0.5 text-xs font-medium text-muted-foreground"
						data-testid="queued-message-sender-name"
					>
						{sender.displayName}
					</div>
				)}
				{isEditing ? (
					<Textarea
						// biome-ignore lint/a11y/noAutofocus: focus follows the explicit edit action
						autoFocus
						value={draftContent}
						onChange={(e) => setDraftContent(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
								e.preventDefault()
								saveEdit()
							} else if (e.key === 'Escape') {
								e.preventDefault()
								cancelEditing()
							}
						}}
						className="min-h-8 px-2 py-1 text-sm md:text-sm"
					/>
				) : (
					<>
						<p
							ref={measureContentOverflow}
							className={cn(
								'text-sm text-muted-foreground whitespace-pre-wrap break-words',
								!isExpanded && 'line-clamp-1',
							)}
						>
							{content}
						</p>
						{(isClamped || isExpanded) && (
							<button
								type="button"
								className="text-xs text-accent cursor-pointer hover:underline hover:text-accent/80 transition-colors mt-1"
								onClick={() => setIsExpanded((prev) => !prev)}
							>
								{isExpanded ? 'Show less' : 'Show more'}
							</button>
						)}
					</>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
				{isEditing ? (
					<>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									disabled={!draftContent.trim()}
									onClick={saveEdit}
									aria-label="Save changes"
								>
									<Check className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Save changes</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									onClick={cancelEditing}
									aria-label="Cancel editing"
								>
									<X className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Cancel editing</TooltipContent>
						</Tooltip>
					</>
				) : (
					<>
						<Badge variant="outline" className="text-xs text-muted-foreground">
							Queued
						</Badge>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5"
									onClick={handleCopy}
									aria-label="Copy message"
								>
									<Copy className="h-3 w-3" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Copy message</TooltipContent>
						</Tooltip>
						{capabilities.canEdit && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-5 w-5"
										onClick={startEditing}
										aria-label="Edit queued message"
									>
										<Pencil className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Edit message</TooltipContent>
							</Tooltip>
						)}
						{capabilities.canSendNow && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-5 w-5"
										onClick={() => onSendNow(id)}
										aria-label="Send queued message now"
									>
										<Send className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Interrupt & send now</TooltipContent>
							</Tooltip>
						)}
						{capabilities.canDelete && (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="h-5 w-5"
										onClick={() => onDelete(id)}
										aria-label="Remove queued message"
									>
										<X className="h-3 w-3" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Remove from queue</TooltipContent>
							</Tooltip>
						)}
					</>
				)}
			</div>
		</div>
	)
}
