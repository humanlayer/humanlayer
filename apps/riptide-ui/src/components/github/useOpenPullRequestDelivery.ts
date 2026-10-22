import { formatOpenPullRequestPrompt } from '@humanlayer/ui/lib/github/open-pull-request-prompt'
import { useMutation } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useSessionDelivery } from '@/components/comment-delivery/useSessionDelivery'
import { useSessionDeliveryCapability } from '@/components/comment-delivery/useSessionDeliveryCapability'

export type OpenPullRequestDeliveryKind = 'send' | 'queue' | 'copy'

export interface OpenPullRequestDelivery {
	/** `copy` when no agent can take the prompt: a task page, or a session in no state to read it. */
	readonly kind: OpenPullRequestDeliveryKind
	readonly pending: boolean
	/** Holds the receipt until a pull request appears on the branch and the control stops rendering. */
	readonly sent: boolean
	readonly error: string | null
	readonly open: (instructions: string | null) => void
}

const MESSAGES = {
	sent: 'The agent has been asked to open a draft pull request.',
	queued: 'Agent is currently working. The request to open a draft pull request has been queued.',
	copied: 'Prompt copied. Paste it into a session to open the pull request.',
} as const

const COPIED = 'copied' as const

/**
 * The "Open a draft PR" behind a branch with none: the same delivery the failing-check sends use,
 * asking for a pull request instead of a fix. Unlike those it keeps a capability without a
 * session, because copying the prompt is the honest answer on a task page rather than no control.
 */
export function useOpenPullRequestDelivery(sessionId: string | null): OpenPullRequestDelivery {
	const capability = useSessionDeliveryCapability({ sessionId: sessionId ?? undefined })
	const session = useSessionDelivery(capability, MESSAGES)

	const delivery = useMutation({
		mutationFn: async (instructions: string | null) => {
			const text = formatOpenPullRequestPrompt(instructions)
			if (capability.kind === 'copy') {
				if (!(await session.copy(text))) throw new Error('Prompt could not be copied.')
				return COPIED
			}
			const acceptance = await session.dispatch(text)
			if (acceptance.kind === 'rejected') throw new Error(`Delivery rejected: ${acceptance.reason}`)
			return acceptance
		},
		onSuccess: (accepted) => {
			if (accepted === COPIED) return
			// Past acceptance the agent has the prompt, so a sync confirmation that fails afterwards
			// must not contradict the toast that already reported it.
			void session.confirm(accepted).catch(() => undefined)
		},
	})

	const { isPending, mutate } = delivery
	const open = useCallback(
		(instructions: string | null) => {
			if (isPending) return
			mutate(instructions)
		},
		[isPending, mutate],
	)

	return {
		kind: capability.kind,
		pending: isPending,
		sent: delivery.isSuccess && delivery.data !== COPIED,
		error: delivery.error?.message ?? null,
		open,
	}
}
