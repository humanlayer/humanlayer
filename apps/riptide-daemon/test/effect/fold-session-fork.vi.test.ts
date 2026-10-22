import { describe, it } from '@effect/vitest'
import { AgentId, EventId, SessionId, decodeStoredLogEntry } from '@humanlayer/fold-core'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { decodePersistedFoldEntry } from '@/effects/services/fold-event-log/fold-event-log-session'
import {
	FoldSessionForkValidationError,
	validateFoldForkedSessionLog,
} from '@/effects/services/fold-sessions/fold-session-fork'

const makeCopiedFoldLog = Effect.fn('test.make_copied_fold_log')(function* (sessionId: string) {
	const rootAgentId = AgentId.create()
	const sessionStartedEventId = EventId.create()
	const cutoffEventId = EventId.create()
	const entries = yield* Effect.forEach(
		[
			{
				_tag: 'session_started',
				version: 1,
				seq: 0,
				eventId: sessionStartedEventId,
				ts: 1,
				agentId: null,
				parentAgentId: null,
				toolCallId: null,
				cwd: '/tmp/fold-fork',
				sessionId,
				rootAgentId,
				meta: {},
			},
			{
				_tag: 'agent-finished',
				version: 1,
				seq: 1,
				eventId: cutoffEventId,
				ts: 2,
				agentId: rootAgentId,
				parentAgentId: null,
				toolCallId: null,
				outcome: 'completed',
				resultText: 'done',
				reason: null,
			},
		],
		decodePersistedFoldEntry,
	)
	return { entries, cutoffEventId, rootAgentId }
})

describe('Fold root-session fork validation', () => {
	it.effect('accepts a copied prefix after the child has appended its own continuation', () =>
		Effect.gen(function* () {
			const childFoldSessionId = SessionId.create()
			const copied = yield* makeCopiedFoldLog(childFoldSessionId)
			const continuation = yield* decodeStoredLogEntry({
				_tag: 'agent-finished',
				version: 1,
				seq: 2,
				eventId: EventId.create(),
				ts: 3,
				agentId: copied.rootAgentId,
				parentAgentId: null,
				toolCallId: null,
				outcome: 'completed',
				resultText: 'child continuation',
				reason: null,
			})
			const input = {
				riptideSessionId: 'child-riptide-session',
				sourceSessionId: 'source-riptide-session',
				codingAgentSessionId: childFoldSessionId,
				forkMetadata: {
					agent: 'fold',
					sourceSessionId: 'source-riptide-session',
					forkAtEventId: 'fork-at-event',
					sourceFoldEventId: copied.cutoffEventId,
					sourceFoldSeq: 1,
					childFoldSessionId,
				},
				entries: [...copied.entries, continuation],
			} as const
			const metadata = yield* validateFoldForkedSessionLog(input)
			const metadataAfterSourceDeletion = yield* validateFoldForkedSessionLog({
				...input,
				sourceSessionId: null,
			})

			expect(metadata.childFoldSessionId).toBe(childFoldSessionId)
			expect(metadata.sourceFoldEventId).toBe(copied.cutoffEventId)
			expect(metadataAfterSourceDeletion).toEqual(metadata)
		}),
	)

	it.effect('rejects a copied log whose terminal event does not match the fork metadata', () =>
		Effect.gen(function* () {
			const childFoldSessionId = SessionId.create()
			const copied = yield* makeCopiedFoldLog(childFoldSessionId)
			const error = yield* validateFoldForkedSessionLog({
				riptideSessionId: 'child-riptide-session',
				sourceSessionId: 'source-riptide-session',
				codingAgentSessionId: childFoldSessionId,
				forkMetadata: {
					agent: 'fold',
					sourceSessionId: 'source-riptide-session',
					forkAtEventId: 'fork-at-event',
					sourceFoldEventId: EventId.create(),
					sourceFoldSeq: 1,
					childFoldSessionId,
				},
				entries: copied.entries,
			}).pipe(Effect.flip)

			expect(error).toBeInstanceOf(FoldSessionForkValidationError)
			expect(error.message).toContain('recorded fork event')
		}),
	)

	it.effect('accepts a copied log with a missing non-boundary event', () =>
		Effect.gen(function* () {
			const childFoldSessionId = SessionId.create()
			const rootAgentId = AgentId.create()
			const cutoffEventId = EventId.create()
			const entries = yield* Effect.forEach(
				[
					{
						_tag: 'session_started',
						version: 1,
						seq: 0,
						eventId: EventId.create(),
						ts: 1,
						agentId: null,
						parentAgentId: null,
						toolCallId: null,
						cwd: '/tmp/fold-fork',
						sessionId: childFoldSessionId,
						rootAgentId,
						meta: {},
					},
					{
						_tag: 'agent-finished',
						version: 1,
						seq: 2,
						eventId: cutoffEventId,
						ts: 3,
						agentId: rootAgentId,
						parentAgentId: null,
						toolCallId: null,
						outcome: 'completed',
						resultText: 'best-effort cutoff',
						reason: null,
					},
				],
				decodePersistedFoldEntry,
			)

			const metadata = yield* validateFoldForkedSessionLog({
				riptideSessionId: 'child-riptide-session',
				sourceSessionId: 'source-riptide-session',
				codingAgentSessionId: childFoldSessionId,
				forkMetadata: {
					agent: 'fold',
					sourceSessionId: 'source-riptide-session',
					forkAtEventId: 'fork-at-event',
					sourceFoldEventId: cutoffEventId,
					sourceFoldSeq: 2,
					childFoldSessionId,
				},
				entries,
			})

			expect(metadata.sourceFoldSeq).toBe(2)
		}),
	)
})
