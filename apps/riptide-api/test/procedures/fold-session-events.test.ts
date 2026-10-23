import { randomUUID } from 'node:crypto'

import { foldSessionEvents } from '@humanlayer/db/tables/fold-session-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, asc, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { appendFoldSessionEventProcedure as liveAppendFoldSessionEventProcedure } from '../../src/orpc/daemon/fold-session-events/append.effect'
import { listFoldSessionEventsProcedure as liveListFoldSessionEventsProcedure } from '../../src/orpc/daemon/fold-session-events/list.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/fold-session-events', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let appendFoldSessionEventProcedure: typeof liveAppendFoldSessionEventProcedure
	let listFoldSessionEventsProcedure: typeof liveListFoldSessionEventsProcedure
	let organizationId: string
	const userId = 'user_fold_event_log'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('fold_session_events')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		appendFoldSessionEventProcedure = bindProcedureToRuntime(liveAppendFoldSessionEventProcedure, effectRuntime)
		listFoldSessionEventsProcedure = bindProcedureToRuntime(liveListFoldSessionEventsProcedure, effectRuntime)

		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Fold Event Log Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!organization) throw new Error('Unable to insert organization for setup')
		organizationId = organization.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createSession = async () => {
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				working_directory: '/tmp/fold-session-events',
				coding_agent: 'fold',
				provider: 'codex',
				model: 'gpt-5.4',
				permissions_mode: 'default',
				status: 'running',
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		return session
	}

	const daemonContext = (overrides: Partial<{ hostId: string; organizationId: string; userId: string }> = {}) => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({
				userId: overrides.userId ?? userId,
				organizationId: overrides.organizationId ?? organizationId,
				hostId: overrides.hostId ?? hostId,
			}),
			services: { db, dbReadReplica: db },
		}),
	})

	const entry = (seq: number, eventId = `event_${randomUUID().replaceAll('-', '')}`) => ({
		_tag: 'session_title',
		seq,
		eventId,
		ts: 1_700_000_000_000 + seq,
		version: 1 as const,
		agentId: null,
		parentAgentId: null,
		toolCallId: null,
		title: `Fold event ${seq}`,
	})
	const appendInput = <T extends { seq: number; eventId: string; ts: number }>(sessionId: string, event: T) => ({
		sessionId,
		entry: { seq: event.seq, eventId: event.eventId, ts: event.ts, event },
	})

	test('appends sequence zero, stores complete JSONB entries, and lists ordered replay rows', async () => {
		const session = await createSession()
		const first = entry(0)
		const second = { ...entry(1), metadata: { nested: ['complete', 'jsonb', 1] } }

		await call(appendFoldSessionEventProcedure, appendInput(session.id, first), daemonContext())
		await call(appendFoldSessionEventProcedure, appendInput(session.id, second), daemonContext())

		const listed = await call(listFoldSessionEventsProcedure, { sessionId: session.id }, daemonContext())
		expect(listed.entries).toEqual([first, second])

		const rows = await db
			.select()
			.from(foldSessionEvents)
			.where(eq(foldSessionEvents.session_id, session.id))
			.orderBy(asc(foldSessionEvents.seq))
		expect(rows).toMatchObject([
			{ session_id: session.id, seq: 0, event_id: first.eventId, ts: first.ts, event: first },
			{ session_id: session.id, seq: 1, event_id: second.eventId, ts: second.ts, event: second },
		])
	})

	test('rejects duplicate event IDs within a session', async () => {
		const session = await createSession()
		const eventId = `event_${randomUUID().replaceAll('-', '')}`

		await call(appendFoldSessionEventProcedure, appendInput(session.id, entry(0, eventId)), daemonContext())

		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, entry(1, eventId)), daemonContext()),
		).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
	})

	test('rejects relational and JSON event envelope mismatches', async () => {
		const session = await createSession()
		const event = entry(0)
		const input = appendInput(session.id, event)
		const contractMismatches = [
			{ ...input.entry, seq: event.seq + 1 },
			{ ...input.entry, eventId: `${event.eventId}_mismatch` },
			{ ...input.entry, ts: event.ts + 1 },
		]

		for (const mismatchedEntry of contractMismatches) {
			await expect(
				call(
					appendFoldSessionEventProcedure,
					{ sessionId: session.id, entry: mismatchedEntry },
					daemonContext(),
				),
			).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		}

		const databaseMismatches = [
			{
				session_id: session.id,
				seq: event.seq + 1,
				event_id: event.eventId,
				ts: event.ts,
				event,
			},
			{
				session_id: session.id,
				seq: event.seq,
				event_id: `${event.eventId}_mismatch`,
				ts: event.ts,
				event,
			},
			{
				session_id: session.id,
				seq: event.seq,
				event_id: event.eventId,
				ts: event.ts + 1,
				event,
			},
		]

		for (const mismatchedRow of databaseMismatches) {
			await expect(db.insert(foldSessionEvents).values(mismatchedRow)).rejects.toBeDefined()
		}
	})

	test('rejects stale and gap sequences', async () => {
		const session = await createSession()

		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, entry(1)), daemonContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		await call(appendFoldSessionEventProcedure, appendInput(session.id, entry(0)), daemonContext())

		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, entry(0)), daemonContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, entry(2)), daemonContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('accepts exact replays of the latest and older persisted appends', async () => {
		const session = await createSession()
		const firstEvent = entry(0)
		const secondEvent = entry(1)
		const firstInput = appendInput(session.id, firstEvent)
		const secondInput = appendInput(session.id, secondEvent)

		const first = await call(appendFoldSessionEventProcedure, firstInput, daemonContext())
		const latestReplay = await call(appendFoldSessionEventProcedure, firstInput, daemonContext())
		await call(appendFoldSessionEventProcedure, secondInput, daemonContext())
		const olderReplay = await call(appendFoldSessionEventProcedure, firstInput, daemonContext())

		expect(first.entry).toEqual(firstEvent)
		expect(latestReplay.entry).toEqual(firstEvent)
		expect(olderReplay.entry).toEqual(firstEvent)
		const rows = await db.select().from(foldSessionEvents).where(eq(foldSessionEvents.session_id, session.id))
		expect(rows).toHaveLength(2)
	})

	test('rejects a stale append whose persisted event identity has a different payload', async () => {
		const session = await createSession()
		const event = entry(0)
		await call(appendFoldSessionEventProcedure, appendInput(session.id, event), daemonContext())

		const conflictingEvent = { ...event, title: 'Conflicting Fold event' }
		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, conflictingEvent), daemonContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })
	})

	test('strips null bytes from event payload before storing', async () => {
		const session = await createSession()
		const event = { ...entry(0), title: 'hello\0world', nested: { content: 'has\0nulls' } }
		const result = await call(appendFoldSessionEventProcedure, appendInput(session.id, event), daemonContext())

		expect(result.entry).toMatchObject({ title: 'helloworld', nested: { content: 'hasnulls' } })
		const [row] = await db
			.select({ event: foldSessionEvents.event })
			.from(foldSessionEvents)
			.where(eq(foldSessionEvents.session_id, session.id))
		expect((row?.event as Record<string, unknown>).title).toBe('helloworld')
	})

	test('regression (RIPTIDE-API-ND): keeps the literal text backslash-u0000 intact while stripping real null bytes', async () => {
		// The previous stripper ran replaceAll on the serialized JSON. JSON.stringify writes a
		// literal backslash as `\\`, so the text backslash-u0000 became `\\u0000`, the replace
		// ate its tail, and JSON.parse threw on the dangling backslash. Every Fold session that
		// read source code mentioning null bytes then failed with a 500 on all five retries.
		const literalEscapeText = String.fromCharCode(92) + 'u0000'
		const session = await createSession()
		const event = {
			...entry(0),
			output: `const key = \`\${a}${literalEscapeText}\${b}\``,
			path: `C:${literalEscapeText}`,
			nested: { content: `has\0nulls`, code: `join("${literalEscapeText}")` },
		}

		const result = await call(appendFoldSessionEventProcedure, appendInput(session.id, event), daemonContext())
		expect(result.entry).toMatchObject({
			output: event.output,
			path: event.path,
			nested: { content: 'hasnulls', code: event.nested.code },
		})

		const [row] = await db
			.select({ event: foldSessionEvents.event })
			.from(foldSessionEvents)
			.where(eq(foldSessionEvents.session_id, session.id))
		const stored = row?.event as Record<string, unknown>
		expect(stored.output).toBe(event.output)
		expect(stored.path).toBe(event.path)
		expect(stored.nested).toEqual({ content: 'hasnulls', code: event.nested.code })
	})

	test('accepts an exact replay of an append whose payload carried null bytes', async () => {
		// The replay comparison must run against the sanitized shape, or a retried append with
		// null bytes would never match its own persisted row and be rejected as a mismatch.
		const session = await createSession()
		const event = { ...entry(0), title: 'hello\0world' }
		await call(appendFoldSessionEventProcedure, appendInput(session.id, event), daemonContext())

		const replay = await call(appendFoldSessionEventProcedure, appendInput(session.id, event), daemonContext())
		expect(replay.entry).toMatchObject({ title: 'helloworld' })

		const rows = await db
			.select({ seq: foldSessionEvents.seq })
			.from(foldSessionEvents)
			.where(eq(foldSessionEvents.session_id, session.id))
		expect(rows).toHaveLength(1)
	})

	test('requires a positive Fold event format version and preserves future versions', async () => {
		const session = await createSession()
		const { version, ...unversionedEntry } = entry(0)
		expect(version).toBe(1)

		await expect(
			call(appendFoldSessionEventProcedure, appendInput(session.id, unversionedEntry) as never, daemonContext()),
		).rejects.toMatchObject({ code: 'BAD_REQUEST' })

		const futureEntry = { ...entry(0), version: 2 }
		const appended = await call(
			appendFoldSessionEventProcedure,
			appendInput(session.id, futureEntry),
			daemonContext(),
		)
		expect(appended.entry).toEqual(futureEntry)
	})

	test('serializes concurrent sequence-zero writers through the parent session lock', async () => {
		const session = await createSession()
		const attempts = await Promise.allSettled(
			Array.from({ length: 8 }, () =>
				call(appendFoldSessionEventProcedure, appendInput(session.id, entry(0)), daemonContext()),
			),
		)

		expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
		expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(7)

		const rows = await db
			.select({ seq: foldSessionEvents.seq })
			.from(foldSessionEvents)
			.where(eq(foldSessionEvents.session_id, session.id))
		expect(rows).toEqual([{ seq: 0 }])
	})

	test('requires the authenticated daemon organization, host, and session owner', async () => {
		const session = await createSession()

		await expect(
			call(
				appendFoldSessionEventProcedure,
				appendInput(session.id, entry(0)),
				daemonContext({ hostId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })

		await expect(
			call(
				listFoldSessionEventsProcedure,
				{ sessionId: session.id },
				daemonContext({ organizationId: randomUUID() }),
			),
		).rejects.toMatchObject({ code: 'NOT_FOUND' })

		await expect(
			call(
				appendFoldSessionEventProcedure,
				appendInput(session.id, entry(0)),
				daemonContext({ userId: 'another-user' }),
			),
		).rejects.toMatchObject({ code: 'FORBIDDEN' })
	})

	test('cascades Fold entries when their parent session is deleted', async () => {
		const session = await createSession()
		await call(appendFoldSessionEventProcedure, appendInput(session.id, entry(0)), daemonContext())

		await db.delete(sessions).where(and(eq(sessions.id, session.id), eq(sessions.organization_id, organizationId)))

		const rows = await db.select().from(foldSessionEvents).where(eq(foldSessionEvents.session_id, session.id))
		expect(rows).toHaveLength(0)
	})
})
