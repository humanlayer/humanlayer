import type { Session } from '@humanlayer/db/tables/sessions'
import {
	getContextWindowUsagePercentage,
	resolveEffectiveContextWindow,
} from '@humanlayer/schemas/effect/model-context'
import { uuidv7 } from 'uuidv7'

import { useSession } from '@/minimalist/lib/data'
import { isBusy } from '@/minimalist/lib/status'
import { useUi } from '@/minimalist/lib/ui-state'
import { useAction } from '@/minimalist/lib/use-action'
import { type RiptideApiClient, useRiptideApi } from '@/orpc/client'

export type SendIntent = 'send' | 'queue' | 'interrupt_and_send'

/** Post a message to a session as if the user typed it. */
export async function sendToSession(api: RiptideApiClient, sessionId: string, text: string, intent: SendIntent) {
	const result = await api.sessions.v2.continue({
		sessionId,
		messageId: uuidv7(),
		eventId: uuidv7(),
		text,
		intent,
	})
	if (result.kind === 'rejected') throw new Error(result.reason)
}

/**
 * Buttons that ask the agent to do something (commit, open a PR, send comments). A busy session
 * queues the message so it never interrupts work, and the toast says which happened. `ask`
 * resolves to whether the message went out; a failure has already shown its own toast.
 */
export function useAskAgent(sessionId: string | null) {
	const { client: api } = useRiptideApi()
	const { showToast } = useUi()
	const action = useAction()
	const session = useSession(sessionId)
	const running = session ? isBusy(session.status) : false

	const ask = async (text: string, toast: { sent: string; queued: string; failed?: string }) => {
		const sent = await action.run(async () => {
			if (!sessionId) throw new Error('No session to send to')
			await sendToSession(api, sessionId, text, running ? 'queue' : 'send')
		}, toast.failed ?? 'Could not send that to the agent. Try again.')
		if (sent) showToast(running ? toast.queued : toast.sent)
		return sent
	}
	const compact = () =>
		ask('/compact', {
			sent: 'Compacting the session',
			queued: 'Compact queued. It runs when the agent finishes.',
			failed: 'Could not compact the session. Try again when the agent finishes.',
		})

	return { ask, compact, running, pending: action.pending }
}

export type ContextUsage = { percent: number; tokens: number; limit: number }

type ContextSession = Pick<Session, 'context_window_limit' | 'context_window_tokens' | 'provider' | 'model'>

/**
 * How full the context window is, or null before the agent reports any tokens. The window comes from the
 * shared resolver the standard badge uses, so a session without a reported limit falls back to its model's.
 */
export function contextUsage(session: ContextSession): ContextUsage | null {
	const tokens = session.context_window_tokens
	if (!tokens) return null
	const limit = resolveEffectiveContextWindow({
		provider: session.provider,
		model: session.model,
		runtimeContextWindow: session.context_window_limit,
	})
	return { percent: getContextWindowUsagePercentage(session.provider, tokens, limit), tokens, limit }
}

export function contextPercent(session: ContextSession): number | null {
	return contextUsage(session)?.percent ?? null
}

/** The usual toast pair for a request named by a short verb phrase, such as "Open a PR". */
export function askToast(request: string) {
	return {
		sent: `Asked the agent to ${request.charAt(0).toLowerCase()}${request.slice(1)}`,
		queued: `${request} queued. It sends when the agent finishes.`,
	}
}
