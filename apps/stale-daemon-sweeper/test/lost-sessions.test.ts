import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { approvals } from '@humanlayer/db/tables/approvals'
import { conversationEvents } from '@humanlayer/db/tables/conversation-events'
import { onlineHosts } from '@humanlayer/db/tables/online-hosts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions, type NewSession, type SessionStatus } from '@humanlayer/db/tables/sessions'
import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import {
	LOST_SESSION_RULES,
	reconcileLostSessions,
	sweepLostSessionsBatch,
	type LostSessionBatchLog,
} from '../lost-sessions'
import { createTestDb } from './test-db'

const NOW = 2_000_000_000n

describe('lost session reconciliation with Postgres', () => {
	let testDb: Awaited<ReturnType<typeof createTestDb>>
	let organizationId: string
	let otherOrganizationId: string

	beforeAll(async () => {
		testDb = await createTestDb('lost_sessions')
		const inserted = await testDb.db
			.insert(organizations)
			.values([
				{ name: 'Lost Sessions Org', workos_organization_id: `org_${randomUUID()}` },
				{ name: 'Other Lost Sessions Org', workos_organization_id: `org_${randomUUID()}` },
			])
			.returning()
		organizationId = inserted[0]!.id
		otherOrganizationId = inserted[1]!.id
	}, 60_000)

	beforeEach(async () => {
		await testDb.db.delete(approvals)
		await testDb.db.delete(conversationEvents)
		await testDb.db.delete(sessions)
		await testDb.db.delete(onlineHosts)
	})

	afterAll(async () => {
		await testDb?.cleanup()
	}, 60_000)

	function sessionValues(overrides: Partial<NewSession> = {}): NewSession {
		const userId = `user_${randomUUID()}`
		return {
			coding_agent: 'claude',
			created_by: userId,
			host_id: randomUUID(),
			last_activity_at: NOW,
			model: 'claude-sonnet-4-5',
			organization_id: organizationId,
			permissions_mode: 'default',
			provider: 'anthropic',
			resource_owner_user_id: userId,
			status: 'running',
			title: 'lost session candidate',
			working_directory: tmpdir(),
			...overrides,
		}
	}

	async function insertSession(overrides: Partial<NewSession> = {}) {
		const [session] = await testDb.db.insert(sessions).values(sessionValues(overrides)).returning()
		if (!session) throw new Error('Expected session insert to return a row')
		return session
	}

	async function insertToolCall(
		session: Awaited<ReturnType<typeof insertSession>>,
		input: {
			toolCallId: string
			toolName: string
			toolInput?: unknown
			createdAt: bigint
			parentToolUseId?: string
		},
	) {
		await testDb.db.insert(conversationEvents).values({
			organization_id: session.organization_id!,
			resource_owner_user_id: session.resource_owner_user_id,
			session_id: session.id,
			event_type: 'tool_call',
			role: 'assistant',
			tool_call_id: input.toolCallId,
			tool_name: input.toolName,
			tool_input_json: input.toolInput,
			parent_tool_use_id: input.parentToolUseId,
			created_at: input.createdAt,
		})
	}

	test.each(LOST_SESSION_RULES)('$status becomes lost only after its strict threshold', async (rule) => {
		const old = await insertSession({ status: rule.status, last_activity_at: NOW - BigInt(rule.thresholdMs) - 1n })
		const boundary = await insertSession({ status: rule.status, last_activity_at: NOW - BigInt(rule.thresholdMs) })
		const recent = await insertSession({
			status: rule.status,
			last_activity_at: NOW - BigInt(rule.thresholdMs) + 1n,
		})

		const result = await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})
		expect(result.sessionsMarkedLost).toBe(1)
		expect(result.transitions).toMatchObject([
			{
				id: old.id,
				status: rule.status,
				thresholdMs: rule.thresholdMs,
				activityAgeMs: BigInt(rule.thresholdMs) + 1n,
				registrationStatus: 'missing',
			},
		])

		const rows = await testDb.db
			.select({ id: sessions.id, status: sessions.status, errorMessage: sessions.error_message })
			.from(sessions)
			.where(inArray(sessions.id, [old.id, boundary.id, recent.id]))
		expect(rows.find(({ id }) => id === old.id)).toMatchObject({ status: 'lost', errorMessage: rule.warning })
		expect(rows.find(({ id }) => id === boundary.id)?.status).toBe(rule.status)
		expect(rows.find(({ id }) => id === recent.id)?.status).toBe(rule.status)
	})

	test('ignores non-eligible states and preserves pending approvals', async () => {
		const nonEligibleStatuses: SessionStatus[] = [
			'ready_for_launch',
			'waiting_for_workspace',
			'draft',
			'failed',
			'ready_for_input',
			'needs_approval',
			'interrupted',
			'lost',
		]
		await testDb.db
			.insert(sessions)
			.values(nonEligibleStatuses.map((status) => sessionValues({ status, last_activity_at: 1n })))
		const candidate = await insertSession({ status: 'interrupt_requested', last_activity_at: 1n })
		const [approval] = await testDb.db
			.insert(approvals)
			.values({
				host_id: candidate.host_id,
				organization_id: organizationId,
				resource_owner_user_id: candidate.resource_owner_user_id,
				session_id: candidate.id,
				status: 'pending',
				tool_input: {},
				tool_name: 'Bash',
				user_id: candidate.created_by,
			})
			.returning()

		expect((await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})).sessionsMarkedLost).toBe(1)
		const unchanged = await testDb.db.select({ status: sessions.status }).from(sessions)
		for (const status of nonEligibleStatuses) expect(unchanged.some((row) => row.status === status)).toBe(true)
		const [approvalAfter] = await testDb.db.select().from(approvals).where(eq(approvals.id, approval!.id))
		expect(approvalAfter?.status).toBe('pending')
	})

	test('reports online, offline, and missing registrations without gating transitions or crossing organizations', async () => {
		const sharedHostId = randomUUID()
		const online = await insertSession({ host_id: sharedHostId, last_activity_at: 1n })
		const offline = await insertSession({ host_id: sharedHostId, last_activity_at: 1n })
		const missing = await insertSession({ host_id: sharedHostId, last_activity_at: 1n })
		await testDb.db.insert(onlineHosts).values([
			{
				host_id: sharedHostId,
				organization_id: organizationId,
				user_id: online.created_by,
				status: 'online',
				last_seen: NOW,
			},
			{
				host_id: sharedHostId,
				organization_id: organizationId,
				user_id: offline.created_by,
				status: 'offline',
				last_seen: NOW,
			},
			{
				host_id: sharedHostId,
				organization_id: otherOrganizationId,
				user_id: missing.created_by,
				status: 'online',
				last_seen: NOW,
			},
		])

		const result = await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})
		expect(new Map(result.transitions.map((row) => [row.id, row.registrationStatus]))).toEqual(
			new Map([
				[online.id, 'online'],
				[offline.id, 'offline'],
				[missing.id, 'missing'],
			]),
		)
	})

	test('exempts every active unresolved Bash or MCP call and handles results, expiry, parsing, case, and child calls', async () => {
		const cases: Array<{
			name: string
			toolName: string
			toolInput?: unknown
			createdAt: bigint
			exempt: boolean
			codingAgent?: NewSession['coding_agent']
		}> = [
			{
				name: 'upper Bash',
				toolName: 'Bash',
				toolInput: { timeout_ms: 600_001 },
				createdAt: NOW - 600_000n,
				exempt: true,
			},
			{
				name: 'lower bash',
				toolName: 'bash',
				toolInput: { timeout_ms: 600_001 },
				createdAt: NOW - 600_000n,
				exempt: true,
			},
			{
				name: 'mixed-case Bash with serialized input',
				toolName: 'bAsH',
				toolInput: JSON.stringify({ timeout_ms: 600_001 }),
				createdAt: NOW - 600_000n,
				exempt: true,
			},
			{
				name: 'expired Bash',
				toolName: 'Bash',
				toolInput: { timeout_ms: 600_000 },
				createdAt: NOW - 600_000n,
				exempt: false,
			},
			{ name: 'missing timeout', toolName: 'Bash', toolInput: {}, createdAt: NOW - 600_000n, exempt: false },
			{
				name: 'malformed timeout',
				toolName: 'Bash',
				toolInput: { timeout_ms: '900000' },
				createdAt: NOW - 600_000n,
				exempt: false,
			},
			{
				name: 'non-positive timeout',
				toolName: 'Bash',
				toolInput: { timeout_ms: 0 },
				createdAt: NOW - 600_000n,
				exempt: false,
			},
			{
				name: 'timeout above runtime maximum',
				toolName: 'Bash',
				toolInput: { timeout_ms: 2_147_483_648 },
				createdAt: NOW - 600_000n,
				exempt: false,
			},
			{
				name: 'active Claude Bash timeout in milliseconds',
				toolName: 'Bash',
				toolInput: { timeout: 600_001 },
				createdAt: NOW - 600_000n,
				exempt: true,
				codingAgent: 'claude',
			},
			{
				name: 'active legacy Bash timeout in seconds',
				toolName: 'Bash',
				toolInput: { timeout: 601 },
				createdAt: NOW - 600_000n,
				exempt: true,
				codingAgent: 'fold',
			},
			{
				name: 'expired legacy Bash timeout in seconds',
				toolName: 'Bash',
				toolInput: { timeout: 600 },
				createdAt: NOW - 600_000n,
				exempt: false,
				codingAgent: 'fold',
			},
			{
				name: 'active MCP',
				toolName: 'mcp__humanlayer__library_researcher',
				createdAt: NOW - 1_199_999n,
				exempt: true,
			},
			{
				name: 'expired MCP',
				toolName: 'mcp__humanlayer__library_researcher',
				createdAt: NOW - 1_200_000n,
				exempt: false,
			},
		]
		const expectedExemptIds: string[] = []
		for (const item of cases) {
			const session = await insertSession({
				title: item.name,
				last_activity_at: NOW - 600_001n,
				coding_agent: item.codingAgent ?? 'claude',
			})
			if (item.exempt) expectedExemptIds.push(session.id)
			await insertToolCall(session, {
				toolCallId: randomUUID(),
				toolName: item.toolName,
				toolInput: item.toolInput,
				createdAt: item.createdAt,
				parentToolUseId: item.name === 'active MCP' ? randomUUID() : undefined,
			})
		}

		const resolved = await insertSession({ title: 'resolved Bash', last_activity_at: NOW - 600_001n })
		const resolvedCallId = randomUUID()
		await insertToolCall(resolved, {
			toolCallId: resolvedCallId,
			toolName: 'Bash',
			toolInput: { timeout_ms: 1_000_000 },
			createdAt: NOW - 600_000n,
		})
		await testDb.db.insert(conversationEvents).values({
			organization_id: organizationId,
			resource_owner_user_id: resolved.resource_owner_user_id,
			session_id: resolved.id,
			event_type: 'tool_result',
			role: 'user',
			tool_result_for_id: resolvedCallId,
			created_at: NOW - 1n,
		})

		const multiple = await insertSession({ title: 'multiple calls', last_activity_at: NOW - 600_001n })
		await insertToolCall(multiple, {
			toolCallId: randomUUID(),
			toolName: 'Bash',
			toolInput: { timeout_ms: 1 },
			createdAt: NOW - 600_000n,
		})
		await insertToolCall(multiple, {
			toolCallId: randomUUID(),
			toolName: 'mcp__test__slow',
			createdAt: NOW - 1n,
		})
		expectedExemptIds.push(multiple.id)

		const result = await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})
		expect(new Set(result.exemptedSessionIds)).toEqual(new Set(expectedExemptIds))
		expect(result.sessionsExemptedByOpenTools).toBe(expectedExemptIds.length)
		const [resolvedAfter] = await testDb.db.select().from(sessions).where(eq(sessions.id, resolved.id))
		expect(resolvedAfter?.status).toBe('lost')
	})

	test.each(['launching', 'resuming', 'interrupt_requested'] as const)(
		'does not apply open-tool exemptions to %s',
		async (status) => {
			const session = await insertSession({ status, last_activity_at: 1n })
			await insertToolCall(session, {
				toolCallId: randomUUID(),
				toolName: 'mcp__test__slow',
				createdAt: NOW - 1n,
			})
			expect((await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})).sessionsMarkedLost).toBe(1)
		},
	)

	test('processes bounded batches while skipping exemptions for the rest of the invocation', async () => {
		const inserted = await testDb.db
			.insert(sessions)
			.values(Array.from({ length: 101 }, () => sessionValues({ last_activity_at: 1n })))
			.returning()
		await insertToolCall(inserted[0]!, {
			toolCallId: randomUUID(),
			toolName: 'Bash',
			toolInput: { timeout_ms: Number(NOW) },
			createdAt: NOW - 1n,
		})

		const result = await reconcileLostSessions(testDb.db, NOW, sweepLostSessionsBatch, () => {})
		expect(result).toEqual({ batchesCompleted: 2, sessionsMarkedLost: 100, sessionsExemptedByOpenTools: 1 })
	})

	test('skips locked candidates and overlapping workers transition each row once', async () => {
		const locked = await insertSession({ last_activity_at: 1n })
		const locker = postgres(testDb.databaseUrl, { max: 1 })
		let announceLocked = () => {}
		const lockAcquired = new Promise<void>((resolve) => {
			announceLocked = resolve
		})
		let releaseLock = () => {}
		const holdLock = new Promise<void>((resolve) => {
			releaseLock = resolve
		})
		const lock = locker.begin(async (tx) => {
			await tx`SELECT 1 FROM sessions WHERE id = ${locked.id} FOR UPDATE`
			announceLocked()
			await holdLock
		})

		try {
			await lockAcquired
			expect((await sweepLostSessionsBatch(testDb.db, NOW, [], () => {})).candidatesClaimed).toBe(0)
		} finally {
			releaseLock()
			await lock
			await locker.end({ timeout: 5 })
		}

		const secondClient = postgres(testDb.databaseUrl, { max: 2 })
		const secondDb = drizzle(secondClient)
		try {
			const results = await Promise.all([
				sweepLostSessionsBatch(testDb.db, NOW, [], () => {}),
				sweepLostSessionsBatch(secondDb, NOW, [], () => {}),
			])
			expect(results.reduce((count, result) => count + result.sessionsMarkedLost, 0)).toBe(1)
		} finally {
			await secondClient.end({ timeout: 5 })
		}
	})

	test('rolls back an interrupted batch and emits telemetry only after commit', async () => {
		const candidate = await insertSession({ last_activity_at: 1n })
		const logs: LostSessionBatchLog[] = []
		await testDb.client.unsafe(`
			CREATE FUNCTION reject_lost_session_update() RETURNS trigger AS $$
			BEGIN RAISE EXCEPTION 'forced lost transition failure'; END;
			$$ LANGUAGE plpgsql;
			CREATE TRIGGER reject_lost_session_update
			BEFORE UPDATE ON sessions FOR EACH ROW
			WHEN (NEW.status = 'lost') EXECUTE FUNCTION reject_lost_session_update();
		`)
		await expect(sweepLostSessionsBatch(testDb.db, NOW, [], (entry) => logs.push(entry))).rejects.toThrow(
			'Failed query',
		)
		await testDb.client.unsafe(`DROP TRIGGER reject_lost_session_update ON sessions`)
		await testDb.client.unsafe(`DROP FUNCTION reject_lost_session_update()`)

		const [after] = await testDb.db.select().from(sessions).where(eq(sessions.id, candidate.id))
		expect(after?.status).toBe('running')
		expect(logs).toEqual([])

		await sweepLostSessionsBatch(testDb.db, NOW, [], (entry) => logs.push(entry))
		expect(logs).toMatchObject([
			{
				event: 'lost_session_batch_completed',
				candidatesClaimed: 1,
				sessionsMarkedLost: 1,
				transitions: [{ id: candidate.id, status: 'running', registrationStatus: 'missing' }],
			},
		])
	})
})
