import { DurableStreamTestServer } from '@durable-streams/server'
import { createStateSchema, createStreamDB } from '@durable-streams/state/db'
import { describe, it } from '@effect/vitest'
import { STREAM_CONFIG } from '@humanlayer/streams/config'
import {
	CheckRowStandardSchema,
	type CheckRowType,
	PR_STATUS_CHECK_TYPE,
	PR_STATUS_META_TYPE,
	type PrStatusKey,
	prStatusStreamPath,
	PullRequestRowStandardSchema,
	type PullRequestRowType,
} from '@humanlayer/streams/pr-status'
import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { DurableStreamsConfig } from '../../src/effects/services/durable-streams/durable-streams-config.service'
import { PrStatusStreamLive } from '../../src/effects/services/pr-status-stream/pr-status-stream.layer'
import { PrStatusStream } from '../../src/effects/services/pr-status-stream/pr-status-stream.service'

const KEY: PrStatusKey = {
	organizationId: '019c26f8-5a48-7256-a1d3-9b7ab52ff22d',
	repoFullName: 'humanlayer/syncopate',
	branch: 'feat/pr-status',
}

const row = (overrides: Partial<PullRequestRowType> = {}): PullRequestRowType => ({
	id: `${KEY.repoFullName}:${KEY.branch}`,
	number: 2261,
	title: 'Show GitHub pull request status in the session sidebar',
	url: 'https://github.com/humanlayer/syncopate/pull/2261',
	state: 'open',
	isDraft: false,
	headRef: KEY.branch,
	baseRef: 'main',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	mergeable: true,
	reviewDecision: null,
	unresolvedThreadCount: null,
	resolvedThreadCount: null,
	changesRequestedReviews: null,
	merge: null,
	...overrides,
})

const check = (overrides: Partial<CheckRowType> = {}): CheckRowType => ({
	id: 'check_run:typecheck',
	name: 'typecheck',
	headSha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
	status: 'COMPLETED',
	conclusion: 'SUCCESS',
	detailsUrl: 'https://github.com/humanlayer/syncopate/actions/runs/1/job/2',
	startedAt: '2026-08-30T09:00:00Z',
	completedAt: '2026-08-30T09:01:12Z',
	...overrides,
})

describe('pr-status stream writer', () => {
	// The suite owns a fresh server; distinct scenario branches isolate its persistent stream state.
	let server: DurableStreamTestServer

	beforeAll(async () => {
		server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
		await server.start()
	})

	afterAll(async () => {
		await server?.stop()
	})

	const layer = () =>
		PrStatusStreamLive.pipe(
			Layer.provide(
				Layer.succeed(DurableStreamsConfig, {
					origin: server.url,
					contentType: STREAM_CONFIG.contentType,
					ttlSeconds: 3600,
					streamUrl: (sessionId: string) => `${server.url}/v1/stream/sessions/${sessionId}`,
				}),
			),
		)

	const splitEnvelopes = (body: string): string[] => {
		const parts: string[] = []
		let depth = 0
		let start = 0
		let inString = false
		let escaped = false
		for (let index = 0; index < body.length; index += 1) {
			const character = body[index]
			if (escaped) {
				escaped = false
			} else if (character === '\\') {
				escaped = true
			} else if (character === '"') {
				inString = !inString
			} else if (!inString && character === '{') {
				if (depth === 0) start = index
				depth += 1
			} else if (!inString && character === '}') {
				depth -= 1
				if (depth === 0) parts.push(body.slice(start, index + 1))
			}
		}
		return parts
	}

	interface RecordedEnvelope {
		type: string
		key: string
		value: Record<string, unknown>
		headers: { operation: string }
	}

	const readEnvelopes = async (key: PrStatusKey): Promise<RecordedEnvelope[]> => {
		const response = await fetch(`${server.url}/v1/stream${prStatusStreamPath(key)}`)
		if (!response.ok) throw new Error(`Unable to read pr-status stream: ${response.status}`)
		return splitEnvelopes(await response.text()).map((part) => JSON.parse(part) as RecordedEnvelope)
	}

	it.effect('lands every append, not just the first', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/repeated' }
			const stream = yield* PrStatusStream

			yield* stream.hydrate(key, { pullRequest: row({ isDraft: true }), checks: [] })
			yield* stream.hydrate(key, {
				pullRequest: row({ isDraft: false, reviewDecision: 'REVIEW_REQUIRED' }),
				checks: [],
			})
			yield* stream.hydrate(key, {
				pullRequest: row({ state: 'merged', reviewDecision: 'APPROVED' }),
				checks: [],
			})

			const rows = yield* Effect.promise(() => readEnvelopes(key))
			expect(rows.length).toBe(3)
			expect(rows.at(-1)?.value.state).toBe('merged')
		}).pipe(Effect.provide(layer())),
	)

	it.effect('writes checks as their own keyed rows, batched into one round trip', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/checks' }
			const stream = yield* PrStatusStream

			yield* stream.hydrate(key, { pullRequest: row(), checks: [] })
			yield* stream.publishChecks(key, [
				check({ id: 'check_run:typecheck', name: 'typecheck', status: 'IN_PROGRESS', conclusion: null }),
				check({ id: 'check_run:test', name: 'test' }),
			])
			yield* stream.publishChecks(key, [
				check({ id: 'check_run:typecheck', name: 'typecheck', conclusion: 'FAILURE' }),
			])

			const envelopes = yield* Effect.promise(() => readEnvelopes(key))
			expect(envelopes.map((envelope) => envelope.type)).toEqual(['pr-meta', 'pr-check', 'pr-check', 'pr-check'])
			expect(envelopes[1]?.key).toBe('check_run:typecheck')
			expect(envelopes[3]?.key).toBe('check_run:typecheck')
			expect(envelopes[3]?.value.conclusion).toBe('FAILURE')
			expect(envelopes.every((envelope) => envelope.headers.operation === 'upsert')).toBe(true)
		}).pipe(Effect.provide(layer())),
	)

	const streamExists = (key: PrStatusKey) =>
		Effect.promise(
			async () => (await fetch(`${server.url}/v1/stream${prStatusStreamPath(key)}`, { method: 'HEAD' })).ok,
		)

	it.effect('publishes checks only to a stream somebody is watching', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/nobody-watching' }
			const stream = yield* PrStatusStream

			yield* stream.publishChecks(key, [check({ id: 'check_run:typecheck', name: 'typecheck' })])
			expect(yield* streamExists(key)).toBe(false)

			yield* stream.hydrate(key, { pullRequest: null, checks: [] })
			yield* stream.publishChecks(key, [check({ id: 'check_run:typecheck', name: 'typecheck' })])
			const envelopes = yield* Effect.promise(() => readEnvelopes(key))
			expect(envelopes.map((envelope) => envelope.type)).toEqual(['pr-check'])
		}).pipe(Effect.provide(layer())),
	)

	it.effect('publishes a pull request change only to a stream somebody is watching', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/pr-changed' }
			const stream = yield* PrStatusStream

			yield* stream.publishPullRequest(key, row({ isDraft: true }))
			expect(yield* streamExists(key)).toBe(false)

			yield* stream.hydrate(key, { pullRequest: row({ isDraft: true }), checks: [] })
			yield* stream.publishPullRequest(key, row({ isDraft: false, reviewDecision: 'APPROVED' }))

			const envelopes = yield* Effect.promise(() => readEnvelopes(key))
			expect(envelopes.map((envelope) => envelope.type)).toEqual(['pr-meta', 'pr-meta'])
			expect(envelopes[1]?.key).toBe(row().id)
			expect(envelopes[1]?.value.isDraft).toBe(false)
			expect(envelopes[1]?.value.reviewDecision).toBe('APPROVED')
		}).pipe(Effect.provide(layer())),
	)

	it.effect('reaches no network at all for an empty check batch', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/no-checks' }
			const stream = yield* PrStatusStream

			yield* stream.publishChecks(key, [])
			expect(yield* streamExists(key)).toBe(false)
		}).pipe(Effect.provide(layer())),
	)

	it.effect('hydrate creates the stream once and a null pull request writes nothing', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/ensure' }
			const stream = yield* PrStatusStream

			yield* stream.hydrate(key, { pullRequest: null, checks: [] })
			yield* stream.hydrate(key, { pullRequest: null, checks: [] })
			expect(yield* streamExists(key)).toBe(true)
			yield* stream.hydrate(key, { pullRequest: row({ isDraft: true }), checks: [] })

			const rows = yield* Effect.promise(() => readEnvelopes(key))
			expect(rows.length).toBe(1)
		}).pipe(Effect.provide(layer())),
	)

	it.effect('replays rows written before the reader subscribed', () =>
		Effect.gen(function* () {
			const key = { ...KEY, branch: 'feat/replay' }
			const stream = yield* PrStatusStream

			yield* stream.hydrate(key, {
				pullRequest: row({ state: 'open' }),
				checks: [
					check({ id: 'check_run:typecheck', name: 'typecheck', conclusion: 'FAILURE' }),
					check({ id: 'check_run:quality', name: 'quality', conclusion: 'SUCCESS' }),
				],
			})

			const db = createStreamDB({
				streamOptions: {
					url: `${server.url}/v1/stream${prStatusStreamPath(key)}`,
					contentType: STREAM_CONFIG.contentType,
				},
				state: createStateSchema({
					pullRequest: { schema: PullRequestRowStandardSchema, type: PR_STATUS_META_TYPE, primaryKey: 'id' },
					checks: { schema: CheckRowStandardSchema, type: PR_STATUS_CHECK_TYPE, primaryKey: 'id' },
				}),
			})
			yield* Effect.promise(() => db.preload())

			try {
				const pullRequests = [...db.collections.pullRequest.values()] as PullRequestRowType[]
				const checks = [...db.collections.checks.values()] as CheckRowType[]

				expect(pullRequests.length).toBe(1)
				expect(pullRequests[0]?.state).toBe('open')
				expect(checks.map((entry) => entry.id).sort()).toEqual(['check_run:quality', 'check_run:typecheck'])
				expect(new Set(checks.map((entry) => entry.headSha))).toEqual(
					new Set(['a1b2c3d4e5f60718293a4b5c6d7e8f9012345678']),
				)
			} finally {
				db.close()
			}
		}).pipe(Effect.provide(layer())),
	)
})
