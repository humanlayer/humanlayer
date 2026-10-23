// File: apps/riptide-api/test/procedures/artifacts-upsert-null-bytes.test.ts
//
// Regression for the "unsupported Unicode escape sequence" failures on artifacts/upsert:
// artifact content (text), frontmatter (jsonb), and operation contents (jsonb) must have
// U+0000 removed before insert, and content_hash must match the stored content.

import { randomUUID } from 'node:crypto'

import { artifactOperationsLog } from '@humanlayer/db/tables/artifact-operations-log'
import { artifacts } from '@humanlayer/db/tables/artifacts'
import { organizations } from '@humanlayer/db/tables/organizations'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { hash } from 'ohash'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { upsertArtifactProcedure } from '../../src/orpc/daemon/artifacts/upsert'
import { createMockDaemonAuth, createMockDaemonContext } from '../mocks'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

const LITERAL_ESCAPE_TEXT = String.fromCharCode(92) + 'u0000'

describe('artifacts upsert: strips null bytes', () => {
	let cleanupTestDb: (() => Promise<void>) | undefined
	let db: PostgresJsDatabase
	let organizationId: string
	let taskId: string
	const userId = 'user_artifact_null_bytes'
	const hostId = randomUUID()

	beforeAll(async () => {
		const testDb = await createTestDb('artifacts_upsert_null_bytes')
		cleanupTestDb = testDb.cleanup
		db = testDb.db

		const [org] = await db
			.insert(organizations)
			.values({ name: 'artifact null bytes org', workos_organization_id: `org_artifact_nul_${randomUUID()}` })
			.returning()
		if (!org) throw new Error('Unable to insert organization for setup')
		organizationId = org.id

		const [task] = await db
			.insert(tasks)
			.values({
				organization_id: organizationId,
				name: 'artifact null bytes task',
				resource_owner_user_id: userId,
				created_by: userId,
			})
			.returning()
		if (!task) throw new Error('Unable to insert task for setup')
		taskId = task.id
	}, 30000)

	afterAll(async () => {
		await cleanupTestDb?.()
	}, 30000)

	function daemonContext() {
		return createMockDaemonContext({
			auth: createMockDaemonAuth({ userId, organizationId, hostId }),
			services: { db, dbReadReplica: db },
		})
	}

	test('stores content, frontmatter, and operation contents with null bytes removed', async () => {
		const content = `# Research\n\nStrip \`\0\` before insert. Source shows ${LITERAL_ESCAPE_TEXT} as text.\n`
		const expectedContent = `# Research\n\nStrip \`\` before insert. Source shows ${LITERAL_ESCAPE_TEXT} as text.\n`

		const result = await call(
			upsertArtifactProcedure,
			{
				taskId,
				fileName: 'research.md',
				content,
				frontmatter: { type: 'research', note: 'has\0nul' },
				operationType: 'Write',
				operationContents: { tool: 'Write', input: { content: 'raw\0call' } },
			},
			{ context: daemonContext() },
		)

		const [row] = await db
			.select({
				content: artifacts.content,
				content_hash: artifacts.content_hash,
				frontmatter: artifacts.frontmatter,
			})
			.from(artifacts)
			.where(eq(artifacts.id, result.artifactId))
		expect(row?.content).toBe(expectedContent)
		expect(row?.content_hash).toBe(hash(expectedContent))
		expect(row?.frontmatter).toEqual({ type: 'research', note: 'hasnul' })

		const [operation] = await db
			.select({ operation_contents: artifactOperationsLog.operation_contents })
			.from(artifactOperationsLog)
			.where(eq(artifactOperationsLog.artifact_id, result.artifactId))
		expect(operation?.operation_contents).toEqual({ tool: 'Write', input: { content: 'rawcall' } })
	})

	test('re-upserting the same content with null bytes does not create a new version', async () => {
		// content_hash is computed on the sanitized content, so a retry that carries the same
		// null bytes hashes to the stored value and is treated as unchanged.
		const content = 'stable\0content'
		const first = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'stable.md', content },
			{ context: daemonContext() },
		)
		const second = await call(
			upsertArtifactProcedure,
			{ taskId, fileName: 'stable.md', content },
			{ context: daemonContext() },
		)
		expect(second.artifactId).toBe(first.artifactId)
		expect(second.created).toBe(false)
		expect(second.versionNumber).toBeUndefined()
	})
})
