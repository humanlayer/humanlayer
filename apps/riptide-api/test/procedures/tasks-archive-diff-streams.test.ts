import { createServer } from 'node:http'

import { describe, it } from '@effect/vitest'
import { organizations } from '@humanlayer/db/tables/organizations'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { Effect } from 'effect'
import { afterAll, beforeAll, expect } from 'vitest'

import { TaskDiffService } from '../../src/effects/services/task-diff-durable-streams/task-diff-durable-streams.service'
import { createTaskArchiveDiffStreamsFixture } from '../fixtures/task-archive-diff-streams'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'
import { requireExternalTestServices } from '../utils/external-test-services'
import { createTestDb } from '../utils/test-db'

await requireExternalTestServices()

describe('tasks.archive diff stream cleanup', () => {
	let db: PostgresJsDatabase
	let cleanup: (() => Promise<void>) | undefined
	let organizationId: string
	const userId = 'archive-diff-stream-owner'

	beforeAll(async () => {
		const testDb = await createTestDb('tasks_archive_diff_streams')
		db = testDb.db
		cleanup = testDb.cleanup
		const [organization] = await db
			.insert(organizations)
			.values({ name: 'Archive Diff Streams', workos_organization_id: 'workos-archive-diff-streams' })
			.returning()
		if (!organization) throw new Error('Failed to create archive lifecycle test organization')
		organizationId = organization.id
	})

	afterAll(async () => cleanup?.())

	it.effect('tasks.archive returns before deleting every task-diff stream', () =>
		Effect.gen(function* () {
			const fixture = yield* Effect.promise(() =>
				createTaskArchiveDiffStreamsFixture({ db, organizationId, userId }),
			)

			try {
				const response = yield* Effect.promise(() => fixture.archive())
				expect(response.success).toBe(true)
				yield* Effect.promise(() => fixture.waitForStreamsDeleted())
				expect(yield* Effect.promise(() => fixture.streamsExist())).toBe(false)
			} finally {
				yield* Effect.promise(() => fixture.dispose())
			}
		}),
	)

	it.effect(
		'absorbs transport failures and keeps deletion total',
		() =>
			Effect.gen(function* () {
				const server = createServer((_request, response) => {
					response.writeHead(404, { connection: 'close', 'content-type': 'text/plain' })
					response.end('Stream not found')
				})
				yield* Effect.promise(() => new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)))
				const address = server.address()
				if (!address || typeof address === 'string') throw new Error('Failure server did not bind a TCP port')
				const origin = `http://127.0.0.1:${address.port}`
				const runtime = createRuntimeWithTestPostgresLayer(db, { durableStreamsOrigin: origin })
				try {
					yield* Effect.promise(() =>
						runtime.runPromise(
							Effect.gen(function* () {
								const taskDiff = yield* TaskDiffService
								yield* taskDiff.deleteTaskDiffStreams({
									organizationId: 'org-failure',
									taskId: 'task-failure',
								})
							}),
						),
					)
				} finally {
					yield* Effect.promise(() => runtime.dispose())
					server.closeAllConnections()
					yield* Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve())))
				}
			}),
		30_000,
	)
})
