import type { ConversationSender } from '@humanlayer/ui/components/conversation-stream'
import { Switch } from '@humanlayer/ui/components/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@humanlayer/ui/components/tooltip'
import { ChevronDown, ChevronUp } from 'lucide-react'

import { QueuedMessageBubble, type QueuedMessageActionCapabilities } from './QueuedMessageBubble'

export interface QueuedMessagesCapabilities extends QueuedMessageActionCapabilities {
	canChangeBatchPreference: boolean
}

export interface QueuedMessagesPaneProps {
	messages: Array<{ id: string; content: string; created_at: bigint; sender?: ConversationSender }>
	showSenderNames: boolean
	isOpen: boolean
	onToggle: () => void
	capabilities: QueuedMessagesCapabilities
	onDelete: (messageId: string) => void
	onSendNow: (messageId: string) => void
	onEdit: (messageId: string, content: string) => void
	preferBatchQueueDelivery: boolean
	onPreferBatchQueueDeliveryChange: (checked: boolean) => void
}

export function QueuedMessagesPane({
	messages,
	isOpen,
	onToggle,
	capabilities,
	onDelete,
	onSendNow,
	onEdit,
	preferBatchQueueDelivery,
	onPreferBatchQueueDeliveryChange,
	showSenderNames,
}: QueuedMessagesPaneProps) {
	if (messages.length === 0) return null

	return (
		// Borderless, same bg as the continue-session editor, and square bottom
		// corners: the pane docks flush on top of the editor as one composer unit.
		<div className="shrink-0 rounded-t-lg bg-accent/5">
			<div className="flex w-full items-center px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/20 transition-colors">
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							className="flex min-w-0 items-center gap-2 cursor-pointer"
							onClick={onToggle}
						>
							<span>
								{messages.length} Queued Message{messages.length !== 1 ? 's' : ''}
							</span>
							{isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
						</button>
					</TooltipTrigger>
					<TooltipContent>{isOpen ? 'Collapse queued messages' : 'Expand queued messages'}</TooltipContent>
				</Tooltip>
				{messages.length > 1 && capabilities.canChangeBatchPreference && (
					<Tooltip>
						<TooltipTrigger asChild>
							<label
								className="flex items-center gap-2 cursor-pointer ml-4"
								onClick={(event) => event.stopPropagation()}
							>
								<span>Batch mode</span>
								<Switch
									checked={preferBatchQueueDelivery}
									onCheckedChange={onPreferBatchQueueDeliveryChange}
								/>
							</label>
						</TooltipTrigger>
						<TooltipContent>
							Batch mode sends all queued messages at once when the agent is ready for more input.
							<br />
							Disabling it sends one queued message at a time.
						</TooltipContent>
					</Tooltip>
				)}
			</div>
			{isOpen && (
				<div className="flex flex-col gap-1.5 px-2 pb-2 max-h-[120px] overflow-y-auto">
					{messages.map((msg) => (
						<QueuedMessageBubble
							key={msg.id}
							id={msg.id}
							content={msg.content}
							createdAt={msg.created_at}
							capabilities={capabilities}
							onDelete={onDelete}
							onSendNow={onSendNow}
							onEdit={onEdit}
							sender={msg.sender}
							showSenderName={showSenderNames}
						/>
					))}
				</div>
			)}
		</div>
	)
}
