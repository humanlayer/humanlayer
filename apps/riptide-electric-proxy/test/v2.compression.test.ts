import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { createElectricTestContext, createTestUser, type ElectricTestContext } from './fixtures'

const CI = !!process.env.CI

/**
 * Shape responses are multi-MB JSON snapshots that Electric serves uncompressed;
 * the proxy gzips them for clients that accept it (see compress middleware in
 * src/server.ts). These tests pin that behaviour: gzip when the client asks for
 * it, identity when it doesn't, and Vary keyed on Accept-Encoding so shared
 * caches never serve the wrong encoding.
 */
describe.skipIf(CI)('/v2 response compression', () => {
	let ctx: ElectricTestContext
	let port: number

	beforeAll(async () => {
		ctx = await createElectricTestContext()

		const testId = randomUUID().slice(0, 8)
		const user = createTestUser(`v2_gzip_${testId}`)
		const server = ctx.createProxyServer({
			user,
			organization: ctx.defaultOrganization,
			key: `v2_gzip_${testId}`,
		})
		port = server.port

		// Seed enough rows that the snapshot comfortably exceeds the compress
		// middleware's 1 KB threshold even if the upstream sets Content-Length.
		for (let i = 0; i < 10; i++) {
			await ctx.seedSession({
				resource_owner_user_id: user.userId,
				organization_id: ctx.defaultOrganization.id,
				working_directory: tmpdir(),
				status: 'draft',
				host_id: randomUUID(),
				created_by: user.userId,
			})
		}
	})

	afterAll(async () => {
		await ctx.shutdown()
	})

	test('gzips the shape snapshot when the client accepts gzip', async () => {
		const response = await fetch(`http://localhost:${port}/v2/sessions?offset=-1`, {
			headers: { 'Accept-Encoding': 'gzip' },
		})

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Encoding')).toBe('gzip')
		expect(response.headers.get('Vary')).toContain('Accept-Encoding')
		expect(response.headers.get('Content-Type')).toContain('application/json')

		// fetch decodes the body transparently; parsing proves the gzip is valid
		const messages = (await response.json()) as Array<{ value?: { id?: string } }>
		expect(messages.filter((m) => m.value?.id).length).toBeGreaterThanOrEqual(10)
	})

	test('returns identity encoding when the client does not accept gzip', async () => {
		const response = await fetch(`http://localhost:${port}/v2/sessions?offset=-1`, {
			headers: { 'Accept-Encoding': 'identity' },
		})

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Encoding')).toBeNull()
		expect(response.headers.get('Vary')).toContain('Accept-Encoding')

		const messages = (await response.json()) as Array<{ value?: { id?: string } }>
		expect(messages.filter((m) => m.value?.id).length).toBeGreaterThanOrEqual(10)
	})
})
