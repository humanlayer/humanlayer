import type { ArtifactDeliveryCapability } from '@humanlayer/ui/artifact-viewer-v2'
import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { useRiptideApi } from '@/orpc/client'

export type SessionDeliveryAcceptance =
	| { kind: 'queued'; transactionId: string }
	| { kind: 'continued'; transactionId: string }
	| { kind: 'rejected'; reason: string }

export interface SessionDeliveryMessages {
	/** Toasted on the server's answer, never on the client's intent. */
	readonly sent: string
	readonly queued: string
	readonly copied?: string
}

export interface SessionDelivery {
	/** Hands the text to the session: queued behind a running agent, sent to an idle one. */
	readonly dispatch: (text: string) => Promise<SessionDeliveryAcceptance>
	/** Reports what the server did and confirms the optimistic row it wrote. */
	readonly confirm: (acceptance: Exclude<SessionDeliveryAcceptance, { kind: 'rejected' }>) => Promise<void>
	/** The fallback when no agent can take the text; false when the clipboard refused. */
	readonly copy: (text: string) => Promise<boolean>
}

/**
 * The one way a prompt reaches a session's agent from the UI, shared by artifact feedback and
 * the GitHub tab: the same capability decides between queue, send and copy, the same toasts
 * report the server's acceptance, and the same transaction confirmations follow.
 */
export function useSessionDelivery(
	capability: ArtifactDeliveryCapability,
	messages: SessionDeliveryMessages,
): SessionDelivery {
	const { client } = useRiptideApi()
	const { confirmTx } = useSyncInternal()
	const { sent, queued, copied } = messages

	const dispatch = useCallback(
		async (text: string): Promise<SessionDeliveryAcceptance> => {
			if (capability.kind === 'copy') return { kind: 'rejected', reason: 'no_session' }
			return client.sessions.v2.continue({
				sessionId: capability.sessionId,
				messageId: uuidv7(),
				eventId: uuidv7(),
				text,
				intent: capability.kind === 'queue' ? 'queue' : 'send',
			})
		},
		[capability, client.sessions.v2],
	)

	const confirm = useCallback(
		async (acceptance: Exclude<SessionDeliveryAcceptance, { kind: 'rejected' }>) => {
			if (acceptance.kind === 'queued') {
				toast.success(queued, { duration: 3000 })
				await confirmTx.queuedMessages(acceptance.transactionId)
			} else {
				toast.success(sent, { duration: 3000 })
				await confirmTx.sessions(acceptance.transactionId)
			}
		},
		[confirmTx.queuedMessages, confirmTx.sessions, queued, sent],
	)

	const copy = useCallback(
		async (text: string) => {
			try {
				await navigator.clipboard.writeText(text)
			} catch {
				return false
			}
			if (copied) toast.success(copied, { duration: 3000 })
			return true
		},
		[copied],
	)

	return useMemo(() => ({ dispatch, confirm, copy }), [confirm, copy, dispatch])
}
