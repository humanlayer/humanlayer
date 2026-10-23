import { sessionCommand } from '@humanlayer/session-sdk-sessions'
import { Effect } from 'effect'

import type { SessionChangeMessage } from '@/collections/types'
import { Sentry } from '@/instrument'
import logger from '@/logger'

import type { InterruptStateService } from '../shared/interrupt-state.service'
import type { DaemonServices } from './types'

/**
 * Check if a change message represents an interrupt request for a specific session.
 * Returns true when status transitions TO 'interrupt_requested' (from any other status).
 */
export function isInterruptRequestedEvent(change: SessionChangeMessage, sessionId: string): boolean {
	const command = sessionCommand(change)
	return command?.kind === 'interrupt' && command.sessionId === sessionId
}

/**
 * Check if the interrupt event includes a new prompt to resume with.
 * Returns resume: true with the new prompt when prompt changed during interrupt.
 */
export function shouldResumeAfterInterrupt(change: SessionChangeMessage): {
	resume: boolean
	newPrompt: string | null
} {
	const currentPrompt = change.value.prompt ?? ''
	const previousPrompt = change.previousValue?.prompt ?? ''
	const hasNewPrompt = change.type === 'update' && !!currentPrompt && currentPrompt !== previousPrompt

	return {
		resume: hasNewPrompt,
		newPrompt: hasNewPrompt ? currentPrompt : null,
	}
}

/**
 * Subscribe to interrupt events for a specific session.
 * Marks the provided interrupt state service when interrupt is detected.
 * Returns unsubscribe function for cleanup.
 */
export function subscribeToSessionInterrupt(options: {
	sessionId: string
	interruptState: InterruptStateService
	eventIterator: { interrupt: () => Promise<unknown> } | undefined
	closeInputStream: (() => void) | undefined
	sessionsCollection: DaemonServices['collections']['sessions']
}): () => void {
	const { sessionId, interruptState, eventIterator, closeInputStream, sessionsCollection } = options

	const subscription = sessionsCollection.subscribeChanges(
		async (changes) => {
			for (const change of changes) {
				if (isInterruptRequestedEvent(change, sessionId)) {
					logger.info({ sessionId }, 'Interrupt requested, calling query.interrupt()')
					await Effect.runPromise(
						interruptState.markInterrupted(shouldResumeAfterInterrupt(change).newPrompt),
					)

					try {
						await eventIterator?.interrupt()
						logger.info({ sessionId }, 'Query interrupted successfully')
					} catch (err) {
						logger.error({ sessionId, err }, 'Error calling interrupt()')
						Sentry.captureException(err, {
							tags: { error_type: 'session_interrupt', session_id: sessionId },
						})
					}

					closeInputStream?.()
					break
				}
			}
		},
		{ includeInitialState: false },
	)

	return () => subscription.unsubscribe()
}

/**
 * Handle interrupt outcomes after session event processing completes.
 * Either marks session as interrupted, or calls onResume to continue with new prompt.
 * Skipped if daemon is shutting down (already handled separately).
 */
export async function handleInterruptOutcome(options: {
	interruptState: InterruptStateService
	sessionId: string
	onResume: (prompt: string) => Promise<void>
	orpc: DaemonServices['orpc']
	shutdown: DaemonServices['shutdown']
}): Promise<void> {
	const { interruptState, sessionId, onResume, orpc, shutdown } = options
	const snapshot = await Effect.runPromise(interruptState.get)

	if (!snapshot.wasInterrupted || shutdown.isDaemonShuttingDown()) {
		return
	}

	if (snapshot.resumeWithPrompt) {
		logger.info(
			{ sessionId, resumeWithPrompt: snapshot.resumeWithPrompt },
			'Resuming interrupted session with new prompt',
		)
		await onResume(snapshot.resumeWithPrompt)
	} else {
		logger.info({ sessionId }, 'Session interrupted, setting status to interrupted')
		await orpc.sessions.update({
			sessionId,
			status: 'interrupted',
		})
	}
}
