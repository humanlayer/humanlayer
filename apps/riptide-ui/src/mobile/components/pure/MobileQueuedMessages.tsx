import { Avatar, AvatarFallback, AvatarImage } from '@humanlayer/ui/components/avatar'
import type { ConversationSender } from '@humanlayer/ui/components/conversation-stream'
import { cn } from '@humanlayer/ui/lib/utils'
import { ChevronDown, Clock3, Send, X } from 'lucide-react'
import { type FC, useState } from 'react'

export interface MobileQueuedMessage {
	id: string
	content: string
	sender?: ConversationSender
	showSenderName?: boolean
}

export interface MobileQueuedMessagesProps {
	messages: MobileQueuedMessage[]
	/** Interrupt the running step and deliver this message now. */
	onSendNow?: (id: string) => void
	/** Remove the message from the queue. */
	onRemove?: (id: string) => void
}

/**
 * Compact mobile display of messages queued while the session is running, shown
 * between the message list and the composer (mirrors the desktop
 * QueuedMessagesPane placement). Display-first with send-now + remove actions;
 * inline editing is intentionally omitted on mobile for simplicity.
 */
export const MobileQueuedMessages: FC<MobileQueuedMessagesProps> = ({ messages, onSendNow, onRemove }) => {
	const [isOpen, setIsOpen] = useState(true)

	if (messages.length === 0) return null

	return (
		<div className="shrink-0 border-t border-border bg-background">
			<button
				type="button"
				onClick={() => setIsOpen((v) => !v)}
				className={cn(
					'flex w-full items-center gap-1.5 px-4 min-h-[40px]',
					'text-[10px] uppercase tracking-[0.18em] text-muted-foreground',
					'hover:text-foreground transition-colors',
				)}
			>
				<Clock3 className="h-3 w-3 shrink-0 text-[var(--terminal-warning)]" />
				<span>
					{messages.length} Queued Message{messages.length === 1 ? '' : 's'}
				</span>
				<ChevronDown
					className={cn('ml-auto h-3.5 w-3.5 shrink-0 transition-transform', !isOpen && '-rotate-90')}
				/>
			</button>

			{isOpen && (
				<div className="max-h-[132px] overflow-y-auto overscroll-contain pb-2">
					{messages.map((msg) => (
						<div key={msg.id} className="flex items-start gap-2 px-4 py-1.5">
							{msg.sender ? (
								<Avatar className="h-5 w-5 shrink-0" title={msg.sender.displayName}>
									<AvatarImage src={msg.sender.profilePictureUrl} alt={msg.sender.displayName} />
									<AvatarFallback className="text-[9px]">{msg.sender.initials}</AvatarFallback>
								</Avatar>
							) : (
								<Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							)}
							<div className="min-w-0 flex-1">
								{msg.showSenderName && msg.sender && (
									<div className="text-[10px] font-medium text-muted-foreground">
										{msg.sender.displayName}
									</div>
								)}
								<p className="whitespace-pre-wrap break-words text-xs text-muted-foreground line-clamp-2">
									{msg.content}
								</p>
							</div>
							{onSendNow && (
								<button
									type="button"
									onClick={() => onSendNow(msg.id)}
									className="relative -my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:text-foreground after:absolute after:-inset-1.5 after:content-['']"
									aria-label="Interrupt and send now"
									title="Interrupt & send now"
								>
									<Send className="h-3.5 w-3.5" />
								</button>
							)}
							{onRemove && (
								<button
									type="button"
									onClick={() => onRemove(msg.id)}
									className="relative -my-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:text-foreground after:absolute after:-inset-1.5 after:content-['']"
									aria-label="Remove from queue"
									title="Remove from queue"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	)
}
