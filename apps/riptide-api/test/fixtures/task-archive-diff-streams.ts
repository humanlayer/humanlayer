import { tmpdir } from 'node:os'

import { DurableStream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import { tasks } from '@humanlayer/db/tables/tasks'
import { call } from '@orpc/server'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { archiveTaskProcedure } from '../../src/orpc/api/tasks/archive'
import { createMockApiAuth, createMockApiContext } from '../mocks'
import { createRuntimeWithTestPostgresLayer } from '../utils/effect-procedure-test-runtime'

export interface TaskArchiveDiffStreamsFixture {
	readonly archive: () => Promise<{ readonly success: boolean }>
	readonly streamsExist: () => Promise<boolean>
	readonly waitForStreamsDeleted: () => Promise<void>
	readonly dispose: () => Promise<void>
}

export async function createTaskArchiveDiffStreamsFixture(input: {
	readonly db: PostgresJsDatabase
	readonly organizationId: string
	readonly userId: string
}): Promise<TaskArchiveDiffStreamsFixture> {
	const server = new DurableStreamTestServer({ port: 0, host: '127.0.0.1' })
	await server.start()
	const runtime = createRuntimeWithTestPostgresLayer(input.db, { durableStreamsOrigin: server.url })
	const [task] = await input.db
		.insert(tasks)
		.values({
			organization_id: input.organizationId,
			name: 'Task with diff streams',
			resource_owner_user_id: input.userId,
			created_by: input.userId,
			default_working_directory: tmpdir(),
			setup_status: 'completed',
			archived: false,
		})
		.returning()
	if (!task) throw new Error('Failed to create archive lifecycle test task')

	const baseUrl = `${server.url}/v1/stream/organizations/${input.organizationId}/tasks/${task.id}`
	const urls = [`${baseUrl}/diff-files`, `${baseUrl}/diff-patches`, `${baseUrl}/diff-file-versions`] as const
	await Promise.all(urls.map((url) => DurableStream.create({ url, contentType: 'application/json' })))
	const heads = () => Promise.all(urls.map((url) => DurableStream.head({ url })))

	return {
		archive: () =>
			call(
				archiveTaskProcedure,
				{ taskId: task.id, archived: true, cascadeToSessions: false },
				{
					context: createMockApiContext({
						auth: createMockApiAuth({
							userId: input.userId,
							organizationId: input.organizationId,
							workosOrganizationId: 'workos-archive-diff-streams',
						}),
						services: { db: input.db, dbReadReplica: input.db, effectRuntime: runtime },
					}),
				},
			),
		streamsExist: async () => (await heads()).some((head) => head.exists),
		waitForStreamsDeleted: async () => {
			for (let attempt = 0; attempt < 100; attempt += 1) {
				if (!(await heads()).some((head) => head.exists)) return
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
		},
		dispose: async () => {
			await runtime.dispose()
			await server.stop()
		},
	}
}
