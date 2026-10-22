import { Pencil, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { useBrowserAuth } from '@/hooks/use-browser-auth'
import { WiredUserAvatar } from '@/minimalist/components/Avatar'
import { CopyButton } from '@/minimalist/components/CopyButton'
import { Toggle } from '@/minimalist/components/SettingsControls'
import { TextDialog } from '@/minimalist/components/TextDialog'
import { useBatchQueueDelivery } from '@/minimalist/lib/batch-queue'
import { plural } from '@/minimalist/lib/format'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

/**
 * Above the queue: how many wait and, for the session's owner, the batch mode switch. The server reads the
 * owner's setting, so nobody else gets a switch that wouldn't change this session.
 */
export function QueueHeader({ count, ownerId }: { count: number; ownerId: string }) {
	const { user } = useBrowserAuth()
	const { batch, setBatch } = useBatchQueueDelivery()
	const owner = user?.id === ownerId
	return (
		<div className="queue-head">
			<span className="muted">{plural(count, 'queued message')}</span>
			{owner ? (
				<label
					className="queue-batch"
					htmlFor="queue-batch-mode"
					title="When the agent finishes, send every queued message at once instead of one at a time"
				>
					Batch mode
					<Toggle id="queue-batch-mode" label="Batch mode" checked={batch} onChange={setBatch} />
				</label>
			) : null}
		</div>
	)
}

export function QueuedMessage({
	sessionId,
	message,
	disabled,
	multiplayer = false,
}: {
	sessionId: string
	message: { id: string; content: string; user_id?: string | null }
	disabled: boolean
	multiplayer?: boolean
}) {
	const { client: api } = useRiptideApi()
	const action = useAction()
	const [editing, setEditing] = useState(false)
	const input = { sessionId, queuedMessageId: message.id }
	return (
		<>
			<div className="queued">
				{multiplayer && message.user_id ? <WiredUserAvatar userId={message.user_id} size={18} /> : null}
				<span className="t" title={message.content}>
					{message.content}
				</span>
				<button
					type="button"
					className="iconbtn"
					title="Send now"
					aria-label="Send now"
					disabled={disabled || action.pending}
					onClick={() =>
						void action.run(
							() => api.sessions.queuedMessages.sendNow(input),
							'Could not send the queued message. Check the session before retrying.',
						)
					}
				>
					<Send className="i sm" strokeWidth={1.6} />
				</button>
				<button
					type="button"
					className="iconbtn"
					title="Edit"
					aria-label="Edit queued message"
					disabled={action.pending}
					onClick={() => setEditing(true)}
				>
					<Pencil className="i sm" strokeWidth={1.6} />
				</button>
				<CopyButton className="iconbtn" label="Copy queued message" text={() => message.content} />
				<button
					type="button"
					className="iconbtn"
					title="Delete"
					aria-label="Delete queued message"
					disabled={action.pending}
					onClick={() =>
						void action.run(
							() => api.sessions.queuedMessages.delete(input),
							'Could not delete the queued message. Check the queue before retrying.',
						)
					}
				>
					<Trash2 className="i sm" strokeWidth={1.6} />
				</button>
			</div>
			{editing ? (
				<TextDialog
					title="Edit queued message"
					initialValue={message.content}
					multiline
					submitLabel="Save message"
					onSave={(text) => api.sessions.queuedMessages.update({ ...input, text })}
					onClose={() => setEditing(false)}
				/>
			) : null}
		</>
	)
}
