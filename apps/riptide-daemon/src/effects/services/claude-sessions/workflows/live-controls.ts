import * as Sentry from '@sentry/bun'
import { Effect, Stream } from 'effect'

import { isInterruptRequestedEvent, shouldResumeAfterInterrupt } from '@/agents/claudecode/interrupts'
import { isModelChangeEvent } from '@/agents/claudecode/model-changes'
import { isPermissionModeChangeEvent, mapToSdkPermissionMode } from '@/agents/claudecode/permission-mode'
import type { InterruptStateService } from '@/agents/shared/interrupt-state.service'

import type { DaemonCollectionsService } from '../../daemon-collections/daemon-collections.service'
import { resolveModelForSdk } from '../query-options'
import type { ClaudeSdkSession } from '../sdk/claude-sdk-session.service'

export function observeLiveSessionControls(input: {
	readonly sessionId: string
	readonly collections: DaemonCollectionsService
	readonly sdkSession: ClaudeSdkSession
	readonly interruptState: InterruptStateService
}) {
	return input.collections.streamSessionChanges(input.sessionId).pipe(
		Stream.runForEach((change) => {
			if (isInterruptRequestedEvent(change, input.sessionId)) {
				const replacementPrompt = shouldResumeAfterInterrupt(change).newPrompt
				return input.interruptState.markInterrupted(replacementPrompt).pipe(
					Effect.andThen(Effect.logInfo('Interrupt requested, interrupting Claude SDK session')),
					Effect.andThen(
						input.sdkSession.controls.interrupt.pipe(
							Effect.tap(() => Effect.logInfo('Claude SDK session interrupted successfully')),
							Effect.catch((error) =>
								Effect.sync(() =>
									Sentry.captureException(error, {
										tags: { error_type: 'session_interrupt', session_id: input.sessionId },
									}),
								).pipe(Effect.andThen(Effect.logError('Error interrupting Claude SDK session'))),
							),
						),
					),
					Effect.ensuring(input.sdkSession.input.close),
					Effect.annotateLogs({ sessionId: input.sessionId }),
					Effect.uninterruptible,
				)
			}

			if (isModelChangeEvent(change, input.sessionId) && change.value.model) {
				const model = resolveModelForSdk(change.value.model)
				return input.sdkSession.controls.setModel(model).pipe(
					Effect.tap(() =>
						Effect.logInfo('SDK model updated successfully').pipe(
							Effect.annotateLogs({ sessionId: input.sessionId, model }),
						),
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'model_change', session_id: input.sessionId },
								extra: { model },
							}),
						).pipe(Effect.andThen(Effect.logError('Error setting model on SDK'))),
					),
				)
			}

			if (isPermissionModeChangeEvent(change, input.sessionId)) {
				const mode = mapToSdkPermissionMode(change.value.permissions_mode)
				return input.sdkSession.controls.setPermissionMode(mode).pipe(
					Effect.tap(() =>
						Effect.logInfo('SDK permission mode updated successfully').pipe(
							Effect.annotateLogs({ sessionId: input.sessionId, mode }),
						),
					),
					Effect.catch((error) =>
						Effect.sync(() =>
							Sentry.captureException(error, {
								tags: { error_type: 'permission_mode_change', session_id: input.sessionId },
								extra: { mode },
							}),
						).pipe(Effect.andThen(Effect.logError('Error setting permission mode on SDK'))),
					),
				)
			}

			return Effect.void
		}),
	)
}
