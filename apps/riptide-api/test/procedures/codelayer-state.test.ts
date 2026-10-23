import { randomUUID } from 'node:crypto'

import { codelayerAgentState } from '@humanlayer/db/tables/codelayer-agent-state'
import { codelayerAgentStateSnapshots } from '@humanlayer/db/tables/codelayer-agent-state-snapshots'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { call } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { uuidv7 } from 'uuidv7'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { getCodelayerStateSnapshotEffectProcedure as liveGetCodelayerStateSnapshotEffectProcedure } from '../../src/orpc/daemon/codelayer-state/snapshot-get.effect'
import { upsertCodelayerStateEffectProcedure as liveUpsertCodelayerStateEffectProcedure } from '../../src/orpc/daemon/codelayer-state/upsert.effect'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { bindProcedureToRuntime, createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('daemon/codelayer-state snapshots', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let effectRuntime: ReturnType<typeof createRuntimeWithTestPostgresLayer> | undefined
	let getCodelayerStateSnapshotProcedure: typeof liveGetCodelayerStateSnapshotEffectProcedure
	let upsertCodelayerStateProcedure: typeof liveUpsertCodelayerStateEffectProcedure
	let organizationId: string
	let sessionId: string
	const userId = 'user_codelayer_state_snapshots'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('codelayer_state_snapshots')
		cleanupTestDb = testDb.cleanup
		db = testDb.db
		effectRuntime = createRuntimeWithTestPostgresLayer(db)
		getCodelayerStateSnapshotProcedure = bindProcedureToRuntime(
			liveGetCodelayerStateSnapshotEffectProcedure,
			effectRuntime,
		)
		upsertCodelayerStateProcedure = bindProcedureToRuntime(liveUpsertCodelayerStateEffectProcedure, effectRuntime)

		const [org] = await db
			.insert(organizations)
			.values({ name: 'CodeLayer State Org', workos_organization_id: `workos-org-${randomUUID()}` })
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				working_directory: '/tmp/codelayer-state-snapshots',
				coding_agent: 'codelayer',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
			})
			.returning()

		if (!session) throw new Error('Unable to insert session for setup')
		sessionId = session.id
	}, 30000)

	afterAll(async () => {
		await effectRuntime?.dispose()
		await cleanupTestDb?.()
	}, 30000)

	const createDaemonContext = () => ({
		context: createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: {
				db,
				dbReadReplica: db,
			},
		}),
	})

	test('returns state for active snapshot rows', async () => {
		await db.insert(codelayerAgentStateSnapshots).values({
			session_id: sessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			run_index: 0,
			state: { messages: [{ role: 'user', content: 'hello' }] },
		})

		const result = await call(getCodelayerStateSnapshotProcedure, { sessionId, runIndex: 0 }, createDaemonContext())

		expect(result).toEqual({ messages: [{ role: 'user', content: 'hello' }] })
	})

	test('upsert writes latest state and automatically snapshots unsnapshotted forkable root user turns', async () => {
		const upsertSessionId = uuidv7()
		await db.insert(sessions).values({
			id: upsertSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			working_directory: '/tmp/codelayer-state-upsert',
			coding_agent: 'codelayer',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_input',
		})

		const [firstEvent] = await db
			.insert(conversationEvents)
			.values({
				session_id: upsertSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'first forkable turn',
			})
			.returning()

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: upsertSessionId,
				state: { messages: [{ role: 'user', content: 'first' }] },
			},
			createDaemonContext(),
		)

		const [latestState] = await db
			.select()
			.from(codelayerAgentState)
			.where(eq(codelayerAgentState.session_id, upsertSessionId))
		expect(latestState?.state).toEqual({ messages: [{ role: 'user', content: 'first' }] })

		let snapshots = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(eq(codelayerAgentStateSnapshots.session_id, upsertSessionId))
			.orderBy(codelayerAgentStateSnapshots.run_index)
		expect(snapshots).toHaveLength(1)
		expect(snapshots[0]?.run_index).toBe(0)
		expect(snapshots[0]?.root_user_event_id).toBe(firstEvent?.id)
		expect(snapshots[0]?.state).toEqual({ messages: [{ role: 'user', content: 'first' }] })

		const [updatedFirstEvent] = await db
			.select({ runIndex: conversationEvents.run_index })
			.from(conversationEvents)
			.where(eq(conversationEvents.id, firstEvent!.id))
		expect(updatedFirstEvent?.runIndex).toBe(0)

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: upsertSessionId,
				state: { messages: [{ role: 'user', content: 'first retry' }] },
			},
			createDaemonContext(),
		)

		const [retriedLatestState] = await db
			.select({ state: codelayerAgentState.state })
			.from(codelayerAgentState)
			.where(eq(codelayerAgentState.session_id, upsertSessionId))
		expect(retriedLatestState?.state).toEqual({ messages: [{ role: 'user', content: 'first retry' }] })

		snapshots = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(eq(codelayerAgentStateSnapshots.session_id, upsertSessionId))
		expect(snapshots).toHaveLength(1)

		const [secondEvent] = await db
			.insert(conversationEvents)
			.values({
				session_id: upsertSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'second forkable turn',
			})
			.returning()

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: upsertSessionId,
				state: { messages: [{ role: 'user', content: 'second' }] },
			},
			createDaemonContext(),
		)

		snapshots = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(eq(codelayerAgentStateSnapshots.session_id, upsertSessionId))
			.orderBy(codelayerAgentStateSnapshots.run_index)
		expect(snapshots).toHaveLength(2)
		expect(snapshots[1]?.run_index).toBe(1)
		expect(snapshots[1]?.root_user_event_id).toBe(secondEvent?.id)
	})

	test('upsert skips snapshot creation when no unsnapshotted forkable root user event exists', async () => {
		const upsertSessionId = uuidv7()
		await db.insert(sessions).values({
			id: upsertSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			working_directory: '/tmp/codelayer-state-upsert-skip',
			coding_agent: 'codelayer',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_input',
		})

		await db.insert(conversationEvents).values([
			{
				session_id: upsertSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'assistant',
				content: 'assistant message',
			},
			{
				session_id: upsertSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message',
				role: 'user',
				content: 'Base directory for this skill: /tmp',
			},
		])

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: upsertSessionId,
				state: { messages: [] },
			},
			createDaemonContext(),
		)

		const snapshots = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(eq(codelayerAgentStateSnapshots.session_id, upsertSessionId))
		expect(snapshots).toHaveLength(0)

		const latestStateRows = await db
			.select()
			.from(codelayerAgentState)
			.where(
				and(
					eq(codelayerAgentState.session_id, upsertSessionId),
					eq(codelayerAgentState.organization_id, organizationId),
				),
			)
		expect(latestStateRows).toHaveLength(1)
	})

	test('upsert stores a compacted latest view without rewriting prior snapshots or conversation events', async () => {
		const compactSessionId = uuidv7()
		await db.insert(sessions).values({
			id: compactSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			working_directory: '/tmp/codelayer-state-compaction',
			coding_agent: 'codelayer',
			provider: 'codex',
			model: 'gpt-5.4',
			permissions_mode: 'default',
			status: 'ready_for_input',
		})

		const originalState = {
			messages: [
				{ role: 'user', content: 'Remember there is always money in the banana stand.' },
				{ role: 'assistant', content: 'I will preserve that fact.' },
			],
			contextWindowTokens: 240_000,
		}
		await db.insert(conversationEvents).values({
			session_id: compactSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			event_type: 'message',
			role: 'user',
			content: 'Remember there is always money in the banana stand.',
		})
		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: compactSessionId,
				state: originalState,
			},
			createDaemonContext(),
		)

		const [priorSnapshot] = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(
				and(
					eq(codelayerAgentStateSnapshots.session_id, compactSessionId),
					eq(codelayerAgentStateSnapshots.run_index, 0),
				),
			)
		if (!priorSnapshot) throw new Error('Expected initial snapshot')
		const priorSnapshotFingerprint = JSON.stringify(priorSnapshot.state)

		const compactionRows = [
			{
				session_id: compactSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message' as const,
				role: 'user' as const,
				content: '/compact Preserve verification commands.',
			},
			{
				session_id: compactSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message' as const,
				role: 'user' as const,
				content: '<conversation>banana stand history</conversation>\n\nCreate a summary.',
			},
			{
				session_id: compactSessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				event_type: 'message' as const,
				role: 'assistant' as const,
				content: '## Goal\nPreserve the banana stand and verification commands.',
			},
		]
		const insertedCompactionRows = await db.insert(conversationEvents).values(compactionRows).returning()
		const compactedState = {
			messages: [
				{
					role: 'user',
					content:
						'<conversation-summary>\n## Goal\nPreserve the banana stand and verification commands.\n</conversation-summary>',
				},
			],
			compaction: {
				version: 1,
				summary: '## Goal\nPreserve the banana stand and verification commands.',
				trigger: 'manual',
				replacedMessageCount: 2,
				retainedMessageCount: 0,
				totalReplacedMessageCount: 2,
				priorContextWindowTokens: 240_000,
			},
		}

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: compactSessionId,
				state: compactedState,
			},
			createDaemonContext(),
		)

		const [latestState] = await db
			.select()
			.from(codelayerAgentState)
			.where(eq(codelayerAgentState.session_id, compactSessionId))
		expect(latestState?.state).toEqual(compactedState)

		const snapshots = await db
			.select()
			.from(codelayerAgentStateSnapshots)
			.where(eq(codelayerAgentStateSnapshots.session_id, compactSessionId))
			.orderBy(codelayerAgentStateSnapshots.run_index)
		expect(snapshots).toHaveLength(2)
		expect(JSON.stringify(snapshots[0]?.state)).toBe(priorSnapshotFingerprint)
		expect(snapshots[1]?.state).toEqual(compactedState)

		const storedEvents = await db
			.select({ id: conversationEvents.id, content: conversationEvents.content })
			.from(conversationEvents)
			.where(eq(conversationEvents.session_id, compactSessionId))
		expect(storedEvents).toHaveLength(4)
		expect(storedEvents.map((event) => event.id)).toEqual(
			expect.arrayContaining(insertedCompactionRows.map((event) => event.id)),
		)
		expect(storedEvents.map((event) => event.content)).toContain(
			'Remember there is always money in the banana stand.',
		)
	})

	test('strips null bytes from state before storing', async () => {
		const nullByteSessionId = uuidv7()
		await db.insert(sessions).values({
			id: nullByteSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			working_directory: '/tmp/codelayer-state-null-bytes',
			coding_agent: 'codelayer',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_input',
		})

		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: nullByteSessionId,
				state: { messages: [{ role: 'user', content: 'hello\0world' }], nested: { text: 'has\0nulls' } },
			},
			createDaemonContext(),
		)

		const [row] = await db
			.select({ state: codelayerAgentState.state })
			.from(codelayerAgentState)
			.where(eq(codelayerAgentState.session_id, nullByteSessionId))
		const state = row?.state as Record<string, unknown>
		const messages = state.messages as Array<Record<string, unknown>>
		expect(messages[0]?.content).toBe('helloworld')
		expect((state.nested as Record<string, unknown>).text).toBe('hasnulls')
	})

	test('regression (RIPTIDE-API-ND): keeps the literal text backslash-u0000 in state intact', async () => {
		// The state path serializes once with the shared replacer and hands the text to
		// Postgres as jsonb. Source code that mentions null bytes must round-trip unchanged
		// while real U+0000 characters are removed.
		const literalEscapeText = String.fromCharCode(92) + 'u0000'
		const literalSessionId = uuidv7()
		await db.insert(sessions).values({
			id: literalSessionId,
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			working_directory: '/tmp/codelayer-state-literal-escape',
			coding_agent: 'codelayer',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_input',
		})

		const code = `const key = \`\${a}${literalEscapeText}\${b}\``
		await call(
			upsertCodelayerStateProcedure,
			{
				sessionId: literalSessionId,
				state: {
					messages: [{ role: 'assistant', content: code }],
					nested: { text: `has\0nul ${literalEscapeText}` },
				},
			},
			createDaemonContext(),
		)

		const [row] = await db
			.select({ state: codelayerAgentState.state })
			.from(codelayerAgentState)
			.where(eq(codelayerAgentState.session_id, literalSessionId))
		const state = row?.state as Record<string, unknown>
		const messages = state.messages as Array<Record<string, unknown>>
		expect(messages[0]?.content).toBe(code)
		expect((state.nested as Record<string, unknown>).text).toBe(`hasnul ${literalEscapeText}`)
	})

	test('returns null for missing, tombstoned, and null-state snapshots', async () => {
		await db.insert(codelayerAgentStateSnapshots).values([
			{
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				run_index: 1,
				state: { messages: [] },
				tombstoned_at: BigInt(Date.now()),
				tombstone_reason: 'retention_expired',
			},
			{
				session_id: sessionId,
				organization_id: organizationId,
				resource_owner_user_id: userId,
				run_index: 2,
				state: null,
			},
		])

		await expect(
			call(getCodelayerStateSnapshotProcedure, { sessionId, runIndex: 99 }, createDaemonContext()),
		).resolves.toBeNull()
		await expect(
			call(getCodelayerStateSnapshotProcedure, { sessionId, runIndex: 1 }, createDaemonContext()),
		).resolves.toBeNull()
		await expect(
			call(getCodelayerStateSnapshotProcedure, { sessionId, runIndex: 2 }, createDaemonContext()),
		).resolves.toBeNull()
	})
})
