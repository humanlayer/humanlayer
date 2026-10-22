import { describe, it } from '@effect/vitest'
import { Effect, Stream } from 'effect'

import type { ClaudeSdkSession } from '@/effects/services/claude-sessions/sdk/claude-sdk-session.service'
import { observeLiveSessionControls } from '@/effects/services/claude-sessions/workflows/live-controls'
import type { DaemonCollectionsService } from '@/effects/services/daemon-collections/daemon-collections.service'

import { makeSessionChange } from '../helpers/session-fixtures'

describe('Effect Claude interruption session', () => {
	it.effect('marks interruption before interrupting the SDK and closing input', ({ expect }) => {
		const order: string[] = []
		const interruptChange = makeSessionChange({
			type: 'update',
			value: { id: 'effect-session-1', status: 'interrupt_requested', prompt: 'replacement' },
			previousValue: { status: 'running', prompt: 'original' },
		})
		const collections: DaemonCollectionsService = {
			current: Effect.die('unused'),
			sessionChanges: Stream.empty,
			taskChanges: Stream.empty,
			approvalChanges: Stream.empty,
			workspaceSetupChanges: Stream.empty,
			providerLoginChanges: Stream.empty,
			workspaceSetups: Stream.empty,
			workspaceSetupSessions: Stream.empty,
			streamSessionChanges: () => Stream.make(interruptChange),
			streamApprovalChanges: () => Stream.never,
		}
		const sdkSession = {
			input: {
				sendMessage: () => Effect.void,
				close: Effect.sync(() => order.push('close')),
			},
			controls: {
				interrupt: Effect.sync(() => order.push('interrupt')),
				setModel: () => Effect.void,
				setPermissionMode: () => Effect.void,
				readUsage: Effect.succeed(undefined),
			},
		} as unknown as ClaudeSdkSession
		let replacementPrompt: string | null = null
		const interruptState = {
			get: Effect.die('unused'),
			wasInterrupted: Effect.die('unused'),
			resumeWithPrompt: Effect.die('unused'),
			markInterrupted: (prompt: string | null) =>
				Effect.sync(() => {
					order.push('mark')
					replacementPrompt = prompt
				}),
		}

		return observeLiveSessionControls({
			sessionId: 'effect-session-1',
			collections,
			sdkSession,
			interruptState,
		}).pipe(
			Effect.andThen(
				Effect.sync(() => {
					expect(order).toEqual(['mark', 'interrupt', 'close'])
					expect(replacementPrompt).toBe('replacement')
				}),
			),
		)
	})
})
