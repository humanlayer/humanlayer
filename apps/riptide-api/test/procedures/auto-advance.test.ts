// File: apps/riptide-api/test/procedures/auto-advance.test.ts

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { sessions } from '@humanlayer/db/tables/sessions'
import { taskUserSettings } from '@humanlayer/db/tables/task-user-settings'
import { tasks } from '@humanlayer/db/tables/tasks'
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { checkAutoAdvance } from '../../src/orpc/daemon/sessions/check-auto-advance'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('Auto-Advance: research-questions → research', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_test'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_research_questions')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization',
				workos_organization_id: 'org_auto_advance_test',
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('creates research session when all conditions met', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Auto Advance',
				slug: 'test-auto-advance',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		// Create research-questions session with rpi:research-questions label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
			})
			.returning()

		// Create artifact with research-questions frontmatter type
		// Note: Drizzle JSONB serialization bug double-stringifies, so frontmatter::text LIKE works
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: '# Research Questions\n\nTest content',
			content_hash: 'test-hash-1',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify a new session was created
		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const researchSession = newSessions[1]

		// Verify session properties
		expect(researchSession?.status).toBe('ready_for_launch')
		expect(researchSession?.title).toBe('research: Test Auto Advance')
		expect(researchSession?.task_id).toBe(task!.id)
		expect(researchSession?.working_directory).toBe('/tmp/test')
		expect(researchSession?.host_id).toBe(hostId)
		expect(researchSession?.model).toBe('claude-sonnet-4-5')
		expect(researchSession?.permissions_mode).toBe('default')
		expect(researchSession?.resource_owner_user_id).toBe(userId)
		expect(researchSession?.created_by).toBe(userId)

		// Verify prompt contains create-research skill and task slug
		expect(researchSession?.prompt).toContain('create-research')
		expect(researchSession?.prompt).toContain('test-auto-advance')

		// Verify labels are set for dedup (label-based dedup relies on these)
		// Drizzle double-encodes JSONB — labels come back as a JSON string
		const rawResearchLabels = researchSession?.labels
		const researchLabels = (
			typeof rawResearchLabels === 'string' ? JSON.parse(rawResearchLabels) : rawResearchLabels
		) as Array<{ name: string; title: string }> | null
		expect(researchLabels).toContainEqual({ name: 'rpi:research', title: 'research' })
	})

	test('does NOT create session when auto_advance flag is false', async () => {
		// Create task with auto-advance DISABLED
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-auto-advance',
				slug: 'test-no-auto-advance',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: false,
			})
			.returning()

		// Create session with label and artifact
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-2',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when session lacks rpi:research-questions label', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-label',
				slug: 'test-no-label',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		// Create session WITHOUT the rpi:research-questions label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'some-other-session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'other-label', title: 'Other' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-3',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when no artifact has research-questions frontmatter type', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-artifact',
				slug: 'test-no-artifact',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		// Create session with correct label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
			})
			.returning()

		// Create artifact WITHOUT research-questions frontmatter type
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '.humanlayer/tasks/test-no-artifact/other.md',
			frontmatter: { type: 'other' },
			content: 'Test',
			content_hash: 'test-hash-4',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create duplicate research session (deduplication)', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-dedup',
				slug: 'test-dedup',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		// Create research-questions session
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				created_at: BigInt(1_000),
			})
			.returning()

		// Create artifact with research-questions in file name
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-dedup',
			created_by: userId,
		})

		// Create an existing research session (simulating a previous auto-advance)
		// Must include the rpi:research label so label-based dedup detects it.
		// Created AFTER the source session so the timestamp-aware dedup still blocks.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'research',
			working_directory: '/tmp/test',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:research', title: 'research' }],
			created_at: BigInt(2_000),
		})

		// Run auto-advance check — should NOT create another
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify only 2 sessions (original + existing research), no duplicate
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('uses task name when slug is null', async () => {
		// Create task with null slug
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-name-fallback',
				slug: null,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-5',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify new session uses task name in prompt
		const newSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(newSessions).toHaveLength(2)
		const researchSession = newSessions.find((s) => s.status === 'ready_for_launch')
		expect(researchSession).toBeDefined()
		expect(researchSession?.prompt).toContain('test-name-fallback')
	})

	test('creates research session on rewind when older sibling predates source (regression)', async () => {
		// Rewind scenario: an older rpi:research sibling exists, then the user creates a
		// fresh rpi:research-questions source session that is newer than that sibling.
		// The timestamp-aware dedup should treat the older sibling as non-blocking and
		// auto-create the next research session.
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Rewind Regression',
				slug: 'test-rewind-regression',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		// Older rpi:research sibling created BEFORE the source session
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'old-research',
			working_directory: '/tmp/test',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:research', title: 'research' }],
			created_at: BigInt(1_000),
		})

		// Newer rpi:research-questions source session (the rewind)
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				created_at: BigInt(2_000),
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-rewind',
			created_by: userId,
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// A new rpi:research session IS created despite the older sibling.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(3)
		const created = allSessions.filter(
			(s) => s.status === 'ready_for_launch' && s.title === 'research: Test Rewind Regression',
		)
		expect(created).toHaveLength(1)
	})

	test('archived newer sibling does NOT block creation', async () => {
		// A newer rpi:research sibling exists but is archived; per the frontend parity
		// filter it should not block auto-creation.
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Archived Sibling',
				slug: 'test-archived-sibling',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				created_at: BigInt(1_000),
			})
			.returning()

		// Newer (after source) but archived rpi:research sibling
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'archived-research',
			working_directory: '/tmp/test',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:research', title: 'research' }],
			archived: true,
			created_at: BigInt(2_000),
		})

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-archived',
			created_by: userId,
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Archived sibling is ignored, so a new research session IS created.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(3)
		const created = allSessions.filter(
			(s) => s.status === 'ready_for_launch' && s.title === 'research: Test Archived Sibling' && !s.archived,
		)
		expect(created).toHaveLength(1)
	})

	test('genuine dedup still holds when sibling created after source', async () => {
		// Regression guard: a non-archived rpi:research sibling created AFTER the source
		// must still block creation so the fix does not disable dedup entirely.
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-dedup-after-source',
				slug: 'test-dedup-after-source',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				created_at: BigInt(1_000),
			})
			.returning()

		// Newer (after source), non-archived rpi:research sibling — should block.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'newer-research',
			working_directory: '/tmp/test',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:research', title: 'research' }],
			created_at: BigInt(2_000),
		})

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-dedup-after',
			created_by: userId,
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// No new session created — only source + the blocking sibling remain.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('disables the task auto-advance flag after creation (owner)', async () => {
		// After auto-advance fires for an owner, the task-level flag for that transition
		// should be turned off so it does not silently re-fire on a subsequent rewind.
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-owner-disable-flag',
				slug: 'test-owner-disable-flag',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_questions_to_research: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research-questions',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '01-research-questions-feature-name.md',
			frontmatter: { type: 'research-questions' },
			content: 'Test',
			content_hash: 'test-hash-owner-disable',
			created_by: userId,
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Session is created (primary outcome) and the task flag is now false.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)

		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(updatedTask?.auto_advance_questions_to_research).toBe(false)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: research → design-discussion', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_test_research_design'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_research_to_design')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		// Set up organization
		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization research to design',
				workos_organization_id: 'org_auto_advance_research_design_test',
			})
			.returning()

		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('creates design-discussion session when all conditions met', async () => {
		// Create task with auto_advance_research_to_design enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Auto Advance Research Design',
				slug: 'test-auto-advance-research-design',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: true,
			})
			.returning()

		// Create research session with rpi:research label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'Research' }],
			})
			.returning()

		// Create artifact with research frontmatter type
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: '# Research\n\nTest content',
			content_hash: 'test-hash-research-1',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify a new session was created
		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const designSession = newSessions[1]

		// Verify session properties
		expect(designSession?.status).toBe('ready_for_launch')
		expect(designSession?.title).toBe('design: Test Auto Advance Research Design')
		expect(designSession?.task_id).toBe(task!.id)
		expect(designSession?.working_directory).toBe('/tmp/test')
		expect(designSession?.host_id).toBe(hostId)
		expect(designSession?.model).toBe('claude-sonnet-4-5')
		expect(designSession?.permissions_mode).toBe('default')
		expect(designSession?.resource_owner_user_id).toBe(userId)
		expect(designSession?.created_by).toBe(userId)

		// Verify prompt contains create-design-discussion skill and task slug
		expect(designSession?.prompt).toContain('create-design-discussion')
		expect(designSession?.prompt).toContain('test-auto-advance-research-design')

		// Verify labels are set for dedup (label-based dedup relies on these)
		// Drizzle double-encodes JSONB — labels come back as a JSON string
		const rawDesignLabels = designSession?.labels
		const designLabels = (
			typeof rawDesignLabels === 'string' ? JSON.parse(rawDesignLabels) : rawDesignLabels
		) as Array<{ name: string; title: string }> | null
		expect(designLabels).toContainEqual({ name: 'rpi:design', title: 'design' })
	})

	test('creates PRD session for prd_tdd workflow after research', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Auto Advance Research PRD',
				slug: 'test-auto-advance-research-prd',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				workflow_type: 'prd_tdd',
				auto_advance_research_to_design: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'research' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: '# Research\n\nTest content',
			content_hash: 'test-hash-research-prd',
			created_by: userId,
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const prdSession = newSessions[1]
		expect(prdSession?.title).toBe('design-prd: Test Auto Advance Research PRD')
		expect(prdSession?.prompt).toContain('rpi:create-prd')

		const rawPrdLabels = prdSession?.labels
		const prdLabels = (typeof rawPrdLabels === 'string' ? JSON.parse(rawPrdLabels) : rawPrdLabels) as Array<{
			name: string
			title: string
		}> | null
		expect(prdLabels).toContainEqual({ name: 'rpi:design-prd', title: 'design-prd' })
	})

	test('does NOT create session when auto_advance_research_to_design flag is false', async () => {
		// Create task with auto-advance DISABLED
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-auto-advance-design',
				slug: 'test-no-auto-advance-design',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: false,
			})
			.returning()

		// Create session with label and artifact
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'Research' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: 'Test',
			content_hash: 'test-hash-research-2',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when session lacks rpi:research label', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-label-design',
				slug: 'test-no-label-design',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: true,
			})
			.returning()

		// Create session WITHOUT the rpi:research label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'some-other-session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'other-label', title: 'Other' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: 'Test',
			content_hash: 'test-hash-research-3',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when no artifact has research frontmatter type', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-no-artifact-design',
				slug: 'test-no-artifact-design',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: true,
			})
			.returning()

		// Create session with correct label
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'Research' }],
			})
			.returning()

		// Create artifact WITHOUT research frontmatter type
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '.humanlayer/tasks/test-no-artifact-design/other.md',
			frontmatter: { type: 'other' },
			content: 'Test',
			content_hash: 'test-hash-research-4',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify NO new session was created
		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create duplicate design-discussion session (deduplication)', async () => {
		// Create task with auto-advance enabled
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-dedup-design',
				slug: 'test-dedup-design',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: true,
			})
			.returning()

		// Create research session
		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: '/tmp/test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'Research' }],
				created_at: BigInt(1_000),
			})
			.returning()

		// Create artifact with research frontmatter type
		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: 'Test',
			content_hash: 'test-hash-research-dedup',
			created_by: userId,
		})

		// Create an existing design-discussion session (simulating a previous auto-advance)
		// Must include the rpi:design label so label-based dedup detects it.
		// Created AFTER the source session so the timestamp-aware dedup still blocks.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'design',
			working_directory: '/tmp/test',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:design', title: 'design' }],
			created_at: BigInt(2_000),
		})

		// Run auto-advance check — should NOT create another
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify only 2 sessions (original + existing design-discussion), no duplicate
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('uses task name when slug is null', async () => {
		// Create task with null slug
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-name-fallback-design',
				slug: null,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_research_to_design: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'research',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research', title: 'Research' }],
			})
			.returning()

		await db.insert(artifacts).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			task_id: task!.id,
			file_name: '02-research-feature-name.md',
			frontmatter: { type: 'research' },
			content: 'Test',
			content_hash: 'test-hash-research-5',
			created_by: userId,
		})

		// Run auto-advance check
		await checkAutoAdvance(db, session!.id, organizationId)

		// Verify new session uses task name in prompt
		const newSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(newSessions).toHaveLength(2)
		const designSession = newSessions.find((s) => s.status === 'ready_for_launch')
		expect(designSession).toBeDefined()
		expect(designSession?.prompt).toContain('test-name-fallback-design')
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: Per-User Resolution via task_user_settings', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string

	const ownerUserId = 'user_owner_per_user'
	const nonOwnerUserId = 'user_non_owner_per_user'

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_per_user_resolution')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'per-user-test', workos_organization_id: 'org_per_user_test' })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('Non-owner with user override true, task flag false — auto-advances (user override wins)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-override-true',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: false,
			})
			.returning()

		// Insert task_user_settings with override
		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_questions_to_research: true,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-session',
				working_directory: '/tmp/test',
			})
			.returning()

		// Create the required artifact
		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-per-user',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should have created a new session (auto-advanced)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('Non-owner with user override false, task flag true — does NOT auto-advance (user override wins)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-override-false',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: true,
			})
			.returning()

		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_questions_to_research: false,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-no-advance',
				working_directory: '/tmp/test',
			})
			.returning()

		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-per-user',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should NOT have created a new session
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(1)
	})

	test('Non-owner with no task_user_settings row, task flag true — auto-advances (falls through to task flag)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-null-override',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: true,
			})
			.returning()

		// No task_user_settings row for nonOwner — LEFT JOIN returns null,
		// so ?? falls through to the task-level flag.

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-null-fallback',
				working_directory: '/tmp/test',
			})
			.returning()

		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-per-user',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should auto-advance (no user settings row → null ?? true = true)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('Owner (no task_user_settings row), task flag true — auto-advances (existing behavior)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'owner-no-settings',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-owner-advance',
				working_directory: '/tmp/test',
			})
			.returning()

		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-per-user',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should auto-advance (owner, task flag true, no user settings)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('Non-owner with existing override row — disables that override flag after creation', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-existing-override-disable',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: false,
			})
			.returning()

		// Existing override row enabling auto-advance for the non-owner creator.
		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_questions_to_research: true,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-disable-existing-override',
				working_directory: '/tmp/test',
			})
			.returning()

		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-existing-override',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Session created and the existing override row's flag flipped to false.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)

		const [override] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
		expect(override?.auto_advance_questions_to_research).toBe(false)

		// Owner's task-level flag is untouched.
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(updatedTask?.auto_advance_questions_to_research).toBe(false)
	})

	test('Non-owner without override row — inserts an override with the transition flag false', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'non-owner-insert-override-disable',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_questions_to_research: true,
				auto_advance_research_to_design: true,
			})
			.returning()

		// No task_user_settings row — resolution falls through to the task flags.
		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:research-questions', title: 'research-questions' }],
				title: 'test-insert-override',
				working_directory: '/tmp/test',
			})
			.returning()

		await db.insert(artifacts).values({
			task_id: task!.id,
			organization_id: organizationId,
			resource_owner_user_id: ownerUserId,
			created_by: ownerUserId,
			file_name: '01-research-questions-test.md',
			content: '# Test',
			content_hash: 'test-hash-insert-override',
			frontmatter: { type: 'research-questions' },
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		// Session created.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)

		// A new override row exists for the non-owner creator with the transition flag
		// false and the other flags copied from the resolved (task-level) values.
		const [override] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, nonOwnerUserId)))
		expect(override).toBeDefined()
		expect(override?.auto_advance_questions_to_research).toBe(false)
		// Copied from the resolved task-level flag (true).
		expect(override?.auto_advance_research_to_design).toBe(true)

		// Owner's task-level flag remains on (only the per-user override was written).
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(updatedTask?.auto_advance_questions_to_research).toBe(true)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: plan → worktree-setup', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_test_plan_worktree'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_plan_to_worktree')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization plan worktree',
				workos_organization_id: 'org_auto_advance_plan_worktree_test',
			})
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('creates worktree-setup session when all conditions met', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Plan To Worktree',
				slug: 'test-plan-to-worktree',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				worktree_timing: 'later',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: '/tmp/test-plan',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'test-plan-to-worktree',
							suggestedDirectory: '/tmp/worktree',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const worktreeSession = newSessions[1]

		expect(worktreeSession?.status).toBe('ready_for_launch')
		expect(worktreeSession?.title).toBe('worktree-setup: Test Plan To Worktree')
		expect(worktreeSession?.task_id).toBe(task!.id)
		// suggestedDirectory should be used as workingDirectory
		expect(worktreeSession?.working_directory).toBe('/tmp/worktree')
		expect(worktreeSession?.host_id).toBe(hostId)
		expect(worktreeSession?.model).toBe('claude-sonnet-4-5')
		expect(worktreeSession?.permissions_mode).toBe('default')
		expect(worktreeSession?.resource_owner_user_id).toBe(userId)
		expect(worktreeSession?.created_by).toBe(userId)

		// Verify prompt contains setup-worktree skill, task slug, and promptSuffix
		expect(worktreeSession?.prompt).toContain('setup-worktree')
		expect(worktreeSession?.prompt).toContain('test-plan-to-worktree')
		expect(worktreeSession?.prompt).toContain('just perform the task without checking with the user')

		// Verify labels
		const rawLabels = worktreeSession?.labels
		const worktreeLabels = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
			name: string
			title: string
		}> | null
		expect(worktreeLabels).toContainEqual({ name: 'rpi:worktree-setup', title: 'worktree-setup' })
	})

	test('creates implementation session for plan auto-advance when worktree timing is now', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Plan To Impl Now',
				slug: 'test-plan-to-impl-now',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				worktree_timing: 'now',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: '/tmp/test-plan-now',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-plan-to-impl-now',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const implSession = newSessions[1]
		expect(implSession?.title).toBe('implementation: Test Plan To Impl Now')
		expect(implSession?.prompt).toContain('implement-plan')
		expect(implSession?.prompt).toContain('test-plan-to-impl-now')
		expect(implSession?.prompt).toContain('implement all phases consecutively')

		const rawLabels = implSession?.labels
		const implLabels = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
			name: string
			title: string
		}> | null
		expect(implLabels).toContainEqual({ name: 'rpi:implementation', title: 'implementation' })
	})

	test('creates implementation session for plan auto-advance when worktree timing is never', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Plan To Impl Never',
				slug: 'test-plan-to-impl-never',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				worktree_timing: 'never',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: '/tmp/test-plan-never',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-plan-to-impl-never',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		expect(newSessions[1]?.title).toBe('implementation: Test Plan To Impl Never')
		expect(newSessions[1]?.prompt).toContain('implement-plan')
	})

	test('does NOT create session when auto_advance_plan_to_worktree flag is false', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-plan-worktree-disabled',
				slug: 'test-plan-worktree-disabled',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_plan_to_worktree: false,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'test-plan-worktree-disabled',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when session lacks rpi:plan label', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-plan-worktree-no-label',
				slug: 'test-plan-worktree-no-label',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'some-other-session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'other-label', title: 'Other' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'test-plan-worktree-no-label',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when next_step_suggestions is null (no extraction result)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-plan-worktree-no-extraction',
				slug: 'test-plan-worktree-no-extraction',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				// next_step_suggestions is null (not set)
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create duplicate worktree-setup session (deduplication)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-plan-worktree-dedup',
				slug: 'test-plan-worktree-dedup',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: '/tmp/test-plan',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'test-plan-worktree-dedup',
						},
					},
				],
				created_at: BigInt(1_000),
			})
			.returning()

		// Create an existing worktree-setup session (simulating a previous auto-advance).
		// Created AFTER the source session so the timestamp-aware dedup still blocks.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'worktree-setup',
			working_directory: '/tmp/worktree',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
			created_at: BigInt(2_000),
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('uses task name when slug is null', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-plan-worktree-name-fallback',
				slug: null,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'plan',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'Plan' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'test-plan-worktree-name-fallback',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(newSessions).toHaveLength(2)
		const worktreeSession = newSessions.find((s) => s.status === 'ready_for_launch')
		expect(worktreeSession).toBeDefined()
		expect(worktreeSession?.prompt).toContain('test-plan-worktree-name-fallback')
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: worktree-setup → implementation', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_test_worktree_impl'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_worktree_to_implementation')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization worktree implementation',
				workos_organization_id: 'org_auto_advance_worktree_impl_test',
			})
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('creates implementation session when all conditions met', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Worktree To Impl',
				slug: 'test-worktree-to-impl',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'worktree-setup',
				working_directory: '/tmp/original-dir',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-worktree-to-impl',
							suggestedDirectory: '/tmp/impl-worktree',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const implSession = newSessions[1]

		expect(implSession?.status).toBe('ready_for_launch')
		expect(implSession?.title).toBe('implementation: Test Worktree To Impl')
		expect(implSession?.task_id).toBe(task!.id)
		// suggestedDirectory should be used as workingDirectory
		expect(implSession?.working_directory).toBe('/tmp/impl-worktree')
		expect(implSession?.host_id).toBe(hostId)
		expect(implSession?.model).toBe('claude-sonnet-4-5')

		// Verify prompt contains implement-plan skill, task slug, and promptSuffix
		expect(implSession?.prompt).toContain('implement-plan')
		expect(implSession?.prompt).toContain('test-worktree-to-impl')
		expect(implSession?.prompt).toContain('implement all phases consecutively without pausing between phases')

		// Verify labels
		const rawLabels = implSession?.labels
		const implLabels = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
			name: string
			title: string
		}> | null
		expect(implLabels).toContainEqual({ name: 'rpi:implementation', title: 'implementation' })

		// Verify task default_working_directory was updated to the suggestedDirectory
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(updatedTask?.default_working_directory).toBe('/tmp/impl-worktree')
	})

	test('does NOT create session when auto_advance_worktree_to_implementation flag is false', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-worktree-impl-disabled',
				slug: 'test-worktree-impl-disabled',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: false,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'worktree-setup',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-worktree-impl-disabled',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)

		// Verify task default_working_directory was NOT updated
		const [unchangedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(unchangedTask?.default_working_directory).toBe(task!.default_working_directory)
	})

	test('does NOT create session when session lacks rpi:worktree-setup label', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-worktree-impl-no-label',
				slug: 'test-worktree-impl-no-label',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'some-other-session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'other-label', title: 'Other' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-worktree-impl-no-label',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when next_step_suggestions is null (no extraction result)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-worktree-impl-no-extraction',
				slug: 'test-worktree-impl-no-extraction',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'worktree-setup',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
				// next_step_suggestions is null
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create duplicate implementation session (deduplication)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-worktree-impl-dedup',
				slug: 'test-worktree-impl-dedup',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'worktree-setup',
				working_directory: '/tmp/original',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-worktree-impl-dedup',
						},
					},
				],
				created_at: BigInt(1_000),
			})
			.returning()

		// Create existing implementation session.
		// Created AFTER the source session so the timestamp-aware dedup still blocks.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'implementation',
			working_directory: '/tmp/impl',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:implementation', title: 'implementation' }],
			created_at: BigInt(2_000),
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('uses task name when slug is null', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-worktree-impl-name-fallback',
				slug: null,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_worktree_to_implementation: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'worktree-setup',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:worktree-setup', title: 'worktree-setup' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:implement-plan skill',
							nextStepSummary: 'Implement plan',
							nextStepType: 'implement-plan',
							taskReference: 'test-worktree-impl-name-fallback',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(newSessions).toHaveLength(2)
		const implSession = newSessions.find((s) => s.status === 'ready_for_launch')
		expect(implSession).toBeDefined()
		expect(implSession?.prompt).toContain('test-worktree-impl-name-fallback')
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: implementation → describe-pr', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	const userId = 'user_test_impl_pr'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_implementation_to_describe_pr')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({
				name: 'test organization implementation pr',
				workos_organization_id: 'org_auto_advance_impl_pr_test',
			})
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('creates describe-pr session when all conditions met', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Impl To PR',
				slug: 'test-impl-to-pr',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: '/tmp/impl-dir',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-impl-to-pr',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)

		expect(newSessions).toHaveLength(2)
		const prSession = newSessions[1]

		expect(prSession?.status).toBe('ready_for_launch')
		expect(prSession?.title).toBe('describe-pr: Test Impl To PR')
		expect(prSession?.task_id).toBe(task!.id)
		// No suggestedDirectory so falls back to session's working_directory
		expect(prSession?.working_directory).toBe('/tmp/impl-dir')
		expect(prSession?.host_id).toBe(hostId)
		expect(prSession?.model).toBe('claude-sonnet-4-5')

		// Verify prompt contains describe-pr skill and task slug (no promptSuffix for this transition)
		expect(prSession?.prompt).toContain('describe-pr')
		expect(prSession?.prompt).toContain('test-impl-to-pr')

		// Verify labels
		const rawLabels = prSession?.labels
		const prLabels = (typeof rawLabels === 'string' ? JSON.parse(rawLabels) : rawLabels) as Array<{
			name: string
			title: string
		}> | null
		expect(prLabels).toContainEqual({ name: 'rpi:describe-pr', title: 'describe-pr' })
	})

	test('does NOT create session when auto_advance_implementation_to_pr flag is false', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-impl-pr-disabled',
				slug: 'test-impl-pr-disabled',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: false,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-impl-pr-disabled',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when session lacks rpi:implementation label', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-impl-pr-no-label',
				slug: 'test-impl-pr-no-label',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'some-other-session',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'other-label', title: 'Other' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-impl-pr-no-label',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create session when next_step_suggestions is null (no extraction result)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-impl-pr-no-extraction',
				slug: 'test-impl-pr-no-extraction',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				// next_step_suggestions is null
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const sessionsAfter = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(sessionsAfter).toHaveLength(1)
	})

	test('does NOT create duplicate describe-pr session (deduplication)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-impl-pr-dedup',
				slug: 'test-impl-pr-dedup',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: '/tmp/impl',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-impl-pr-dedup',
						},
					},
				],
				created_at: BigInt(1_000),
			})
			.returning()

		// Create existing describe-pr session.
		// Created AFTER the source session so the timestamp-aware dedup still blocks.
		await db.insert(sessions).values({
			organization_id: organizationId,
			resource_owner_user_id: userId,
			created_by: userId,
			host_id: hostId,
			task_id: task!.id,
			title: 'describe-pr',
			working_directory: '/tmp/impl',
			coding_agent: 'claude',
			provider: 'anthropic',
			model: 'claude-sonnet-4-5',
			permissions_mode: 'default',
			status: 'ready_for_launch',
			labels: [{ name: 'rpi:describe-pr', title: 'describe-pr' }],
			created_at: BigInt(2_000),
		})

		await checkAutoAdvance(db, session!.id, organizationId)

		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('uses task name when slug is null', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'test-impl-pr-name-fallback',
				slug: null,
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: tmpdir(),
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-impl-pr-name-fallback',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		const newSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(newSessions).toHaveLength(2)
		const prSession = newSessions.find((s) => s.status === 'ready_for_launch')
		expect(prSession).toBeDefined()
		expect(prSession?.prompt).toContain('test-impl-pr-name-fallback')
	})

	// CORE-1489 repro: an owner whose incidental task_user_settings row carries the
	// stale schema-default (false) for auto_advance_implementation_to_pr must still
	// auto-advance, because owners read the task-level flag (true) and ignore their
	// own per-user override. Fails before the owner-aware-read fix.
	test('Owner with stale task_user_settings row (task flag true, user flag false) — auto-advances', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Owner Stale TUS Impl PR',
				slug: 'test-owner-stale-tus-impl-pr',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		// Owner's incidental TUS row, seeded with the schema-default false for the
		// implementation-to-PR flag (the create-time workspace-materialization path).
		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: userId,
			organization_id: organizationId,
			auto_advance_implementation_to_pr: false,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: userId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: '/tmp/impl-dir',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-owner-stale-tus-impl-pr',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Owner reads task-level (true) and ignores the stale TUS false → advances.
		const newSessions = await db
			.select()
			.from(sessions)
			.where(eq(sessions.task_id, task!.id))
			.orderBy(sessions.created_at)
		expect(newSessions).toHaveLength(2)
		const prSession = newSessions[1]
		expect(prSession?.status).toBe('ready_for_launch')
		expect(prSession?.prompt).toContain('describe-pr')

		// Owner disable path flips the task-level flag (the row owners read) to false.
		const [updatedTask] = await db.select().from(tasks).where(eq(tasks.id, task!.id))
		expect(updatedTask?.auto_advance_implementation_to_pr).toBe(false)

		// The owner's stale TUS row is left untouched (owners no longer read it).
		const [override] = await db
			.select()
			.from(taskUserSettings)
			.where(and(eq(taskUserSettings.task_id, task!.id), eq(taskUserSettings.user_id, userId)))
		expect(override?.auto_advance_implementation_to_pr).toBe(false)
	})

	// Mirror of the questions-to-research non-owner override test for implementation → PR:
	// a non-owner's per-user override (false) still wins over a task flag (true), proving
	// the override path is preserved after the owner-aware-read change.
	test('Non-owner with user override false, task flag true — does NOT auto-advance (user override wins)', async () => {
		const nonOwnerUserId = 'user_non_owner_impl_pr'
		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'Test Non-Owner Override Impl PR',
				slug: 'test-non-owner-override-impl-pr',
				resource_owner_user_id: userId,
				created_by: userId,
				default_working_directory: tmpdir(),
				setup_status: 'completed',
				auto_advance_implementation_to_pr: true,
			})
			.returning()

		// Non-owner override disabling the transition.
		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_implementation_to_pr: false,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				organization_id: organizationId,
				resource_owner_user_id: userId,
				created_by: nonOwnerUserId,
				host_id: hostId,
				task_id: task!.id,
				title: 'implementation',
				working_directory: '/tmp/impl-dir',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:implementation', title: 'Implementation' }],
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:describe-pr skill',
							nextStepSummary: 'Describe PR',
							nextStepType: 'describe-pr',
							taskReference: 'test-non-owner-override-impl-pr',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Non-owner override (false) wins over the task flag (true) → no new session.
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(1)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})

describe('Auto-Advance: Per-User Resolution for new flags (plan → worktree)', async () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string

	const ownerUserId = 'user_owner_per_user_new'
	const nonOwnerUserId = 'user_non_owner_per_user_new'

	beforeAll(async () => {
		const testDb = await createTestDb('auto_advance_new_flags_per_user')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'per-user-new-flags-test', workos_organization_id: 'org_per_user_new_flags_test' })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id
	}, 30000)

	test('Non-owner with user override true, task flag false — auto-advances (user override wins)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-plan-worktree-override-true',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_plan_to_worktree: false,
			})
			.returning()

		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_plan_to_worktree: true,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-new-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'plan' }],
				title: 'test-plan-session',
				working_directory: '/tmp/test',
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'per-user-plan-worktree-override-true',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should have created a new session (user override true wins)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('Non-owner with user override false, task flag true — does NOT auto-advance (user override wins)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-plan-worktree-override-false',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		await db.insert(taskUserSettings).values({
			task_id: task!.id,
			user_id: nonOwnerUserId,
			organization_id: organizationId,
			auto_advance_plan_to_worktree: false,
		})

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-new-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'plan' }],
				title: 'test-plan-no-advance',
				working_directory: '/tmp/test',
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'per-user-plan-worktree-override-false',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should NOT have created a new session (user override false wins)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(1)
	})

	test('Non-owner with no task_user_settings row, task flag true — auto-advances (falls through to task flag)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-plan-worktree-null-override',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		// No task_user_settings row for nonOwner — LEFT JOIN returns null,
		// so ?? falls through to the task-level flag.

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: nonOwnerUserId,
				host_id: 'host-per-user-new-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'plan' }],
				title: 'test-plan-null-fallback',
				working_directory: '/tmp/test',
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'per-user-plan-worktree-null-override',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should auto-advance (no user settings row → null ?? true = true)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	test('Owner (no task_user_settings row), task flag true — auto-advances (existing behavior)', async () => {
		const [task] = await db
			.insert(tasks)
			.values({
				name: 'per-user-plan-worktree-owner',
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				organization_id: organizationId,
				auto_advance_plan_to_worktree: true,
			})
			.returning()

		// No task_user_settings row — owner scenario

		const [session] = await db
			.insert(sessions)
			.values({
				task_id: task!.id,
				organization_id: organizationId,
				resource_owner_user_id: ownerUserId,
				created_by: ownerUserId,
				host_id: 'host-per-user-new-test',
				coding_agent: 'claude',
				provider: 'anthropic',
				model: 'claude-sonnet-4-5',
				permissions_mode: 'default',
				status: 'ready_for_input',
				labels: [{ name: 'rpi:plan', title: 'plan' }],
				title: 'test-owner-plan-advance',
				working_directory: '/tmp/test',
				next_step_suggestions: [
					{
						parsedAt: Date.now(),
						extraction: {
							type: 'next_step_found',
							nextStepPrompt: 'use the rpi:setup-worktree skill',
							nextStepSummary: 'Setup worktree',
							nextStepType: 'setup-worktree',
							taskReference: 'per-user-plan-worktree-owner',
						},
					},
				],
			})
			.returning()

		await checkAutoAdvance(db, session!.id, organizationId)

		// Should auto-advance (owner, task flag true, no user settings)
		const allSessions = await db.select().from(sessions).where(eq(sessions.task_id, task!.id))
		expect(allSessions).toHaveLength(2)
	})

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)
})
