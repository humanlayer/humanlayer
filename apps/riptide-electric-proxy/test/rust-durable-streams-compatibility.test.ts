import { getExternalTestServicesConfig } from '@humanlayer/test-fixtures/external-test-services'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'

import type { AppConfig } from '../src/app-config'
import { createTestAppRuntime } from '../src/lib/effect/runtime'
import { createStreamsApp } from '../src/routes/streams'

const sql = postgres('postgres://unused:unused@127.0.0.1:1/unused', { connect_timeout: 1, max: 1 })
const db = drizzle(sql)

afterAll(() => sql.end())

describe('Rust durable-streams-server proxy compatibility', () => {
	it('creates, appends, and reads a task stream through the authenticated proxy route', async () => {
		const organizationId = crypto.randomUUID()
		const taskId = crypto.randomUUID()
		const { durableStreamsOrigin } = getExternalTestServicesConfig()
		const effectRuntime = createTestAppRuntime({
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin,
		})
		const config: AppConfig = {
			electricShapeUrl: 'http://electric.invalid',
			durableStreamsOrigin,
			testAuthContext: { organizationId, userId: 'compatibility-user', hostId: 'compatibility-host' },
			effectRuntime,
			db,
		}
		const app = createStreamsApp(config, { sessions: false })
		const path = `/organizations/${organizationId}/tasks/${taskId}/diff-files`

		try {
			const create = await app.request(path, {
				method: 'PUT',
				headers: { 'content-length': '0', 'content-type': 'application/json' },
			})
			expect(create.status).toBe(201)

			const append = await app.request(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '[{"event":"through-proxy"}]',
			})
			expect(append.status).toBe(204)

			const read = await app.request(`${path}?offset=-1`)
			expect(read.status).toBe(200)
			expect(await read.json()).toEqual([{ event: 'through-proxy' }])
		} finally {
			await fetch(
				`${durableStreamsOrigin}/v1/stream/organizations/${organizationId}/tasks/${taskId}/diff-files`,
				{ method: 'DELETE' },
			)
			await effectRuntime.dispose()
		}
	})
})
