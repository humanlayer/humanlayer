import { Effect } from 'effect'

import { DaemonCollections } from '../daemon-collections/daemon-collections.service'
import { StreamProducerLiveForSession } from '../stream-producer/stream-producer.service'
import type { PreparedClaudeRun } from './prepare-claude-session'
import type { ClaudeSdkSession } from './sdk/claude-sdk-session.service'
import { observeLiveSessionControls } from './workflows/live-controls'
import { processClaudeEvents } from './workflows/process-events'

export const processOpenClaudeSdkSession = Effect.fn('claude.process_open_sdk_session')(function* (input: {
	readonly prepared: PreparedClaudeRun
	readonly sdkSession: ClaudeSdkSession
	readonly onResult?: Effect.Effect<void>
}) {
	const collections = yield* DaemonCollections
	const sessionId = input.prepared.session.id

	yield* observeLiveSessionControls({
		sessionId,
		collections,
		sdkSession: input.sdkSession,
		interruptState: input.prepared.interruptState,
	}).pipe(Effect.forkScoped)

	yield* processClaudeEvents({
		session: input.prepared.session,
		sdkSession: input.sdkSession,
		interruptState: input.prepared.interruptState,
		onResult: input.onResult,
	}).pipe(Effect.provide(StreamProducerLiveForSession({ sessionId })))
})
