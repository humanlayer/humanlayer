import type { SDKCompactBoundaryMessage, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, it } from '@effect/vitest'
import { Effect, Option, Stream } from 'effect'
import { expect } from 'vitest'

import {
	type PairedSDKMessage,
	pairCompactBoundariesWithSummaries,
} from '../../src/effects/services/claude-sessions/workflows/pair-compact-boundaries-with-summaries'

type Uuid = SDKCompactBoundaryMessage['uuid']

const boundary = (uuid: Uuid): SDKCompactBoundaryMessage => ({
	type: 'system',
	subtype: 'compact_boundary',
	compact_metadata: { trigger: 'manual', pre_tokens: 1000, post_tokens: 100 },
	uuid,
	session_id: 'session-1',
})

const userMessage = (uuid: Uuid, content: string, isSynthetic: boolean): SDKUserMessage => ({
	type: 'user',
	message: { role: 'user', content },
	parent_tool_use_id: null,
	uuid,
	session_id: 'session-1',
	isSynthetic,
})

const statusMessage = (uuid: Uuid): SDKMessage => ({
	type: 'system',
	subtype: 'status',
	status: null,
	uuid,
	session_id: 'session-1',
})

const pair = (messages: ReadonlyArray<SDKMessage>) =>
	Stream.fromIterable(messages).pipe(pairCompactBoundariesWithSummaries, Stream.runCollect)

const summaryOf = (message: PairedSDKMessage) =>
	message.type === 'system' && message.subtype === 'compact_boundary' ? message.summary : undefined

const uuidsOf = (messages: ReadonlyArray<PairedSDKMessage>) => messages.map((message) => message.uuid)

describe('pairCompactBoundariesWithSummaries', () => {
	it.effect('attaches the synthetic user message that follows a boundary and drops it from the stream', () =>
		Effect.gen(function* () {
			const paired = yield* pair([
				statusMessage('status-1-0-0-0-0'),
				boundary('boundary-1-0-0-0-0'),
				userMessage('summary-1-0-0-0-0', 'This session is being continued…', true),
				userMessage('stdout-1-0-0-0-0', '<local-command-stdout>Compacted </local-command-stdout>', false),
			])
			expect(uuidsOf(paired)).toEqual(['status-1-0-0-0-0', 'boundary-1-0-0-0-0', 'stdout-1-0-0-0-0'])
			expect(summaryOf(paired[1]!)).toEqual(
				Option.some({ uuid: 'summary-1-0-0-0-0', text: 'This session is being continued…' }),
			)
		}),
	)

	it.effect('releases a boundary without a summary when the next message is not one', () =>
		Effect.gen(function* () {
			const paired = yield* pair([
				boundary('boundary-1-0-0-0-0'),
				userMessage('prompt-1-0-0-0-0', 'hello', false),
			])
			expect(uuidsOf(paired)).toEqual(['boundary-1-0-0-0-0', 'prompt-1-0-0-0-0'])
			expect(summaryOf(paired[0]!)).toEqual(Option.none())
		}),
	)

	it.effect('releases a boundary held at the end of the stream', () =>
		Effect.gen(function* () {
			const paired = yield* pair([statusMessage('status-1-0-0-0-0'), boundary('boundary-1-0-0-0-0')])
			expect(uuidsOf(paired)).toEqual(['status-1-0-0-0-0', 'boundary-1-0-0-0-0'])
			expect(summaryOf(paired[1]!)).toEqual(Option.none())
		}),
	)

	it.effect('keeps both boundaries when two arrive back to back', () =>
		Effect.gen(function* () {
			const paired = yield* pair([
				boundary('boundary-1-0-0-0-0'),
				boundary('boundary-2-0-0-0-0'),
				userMessage('summary-2-0-0-0-0', 'second summary', true),
			])
			expect(uuidsOf(paired)).toEqual(['boundary-1-0-0-0-0', 'boundary-2-0-0-0-0'])
			expect(summaryOf(paired[0]!)).toEqual(Option.none())
			expect(summaryOf(paired[1]!)).toEqual(Option.some({ uuid: 'summary-2-0-0-0-0', text: 'second summary' }))
		}),
	)

	it.effect('ignores synthetic messages that carry no text or arrive without a boundary', () =>
		Effect.gen(function* () {
			const paired = yield* pair([
				userMessage('synthetic-0-0-0-0-0', 'skill prompt', true),
				boundary('boundary-1-0-0-0-0'),
				userMessage('empty-1-0-0-0-0', '', true),
			])
			expect(uuidsOf(paired)).toEqual(['synthetic-0-0-0-0-0', 'boundary-1-0-0-0-0', 'empty-1-0-0-0-0'])
			expect(summaryOf(paired[1]!)).toEqual(Option.none())
		}),
	)

	it.effect('passes a stream with no boundaries through unchanged', () =>
		Effect.gen(function* () {
			const messages = [statusMessage('status-1-0-0-0-0'), userMessage('prompt-1-0-0-0-0', 'hello', false)]
			expect(yield* pair(messages)).toEqual(messages)
		}),
	)
})
