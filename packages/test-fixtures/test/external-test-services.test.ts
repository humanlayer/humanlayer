import { describe, expect, it } from 'vitest'

import {
	formatExternalTestServicesError,
	getExternalTestServicesConfig,
	getExternalTestServicesComposeArgs,
	getExternalTestServicesElectricShapeUrl,
	getExternalTestServicesRecoveryCommands,
	TEST_ELECTRIC_PORT,
	TEST_DURABLE_STREAMS_PORT,
	TEST_POSTGRES_PORT,
	waitForExternalTestServices,
} from '../src/external-test-services'

describe('external test services config', () => {
	it('uses stable defaults', () => {
		const config = getExternalTestServicesConfig({})

		expect(config.postgresAdminUrl).toBe(
			`postgresql://postgres:humanlayer_test_password@127.0.0.1:${TEST_POSTGRES_PORT}/postgres`,
		)
		expect(config.postgresDatabaseUrlTemplate).toContain('{database}')
		expect(config.electricUrl).toBe(`http://127.0.0.1:${TEST_ELECTRIC_PORT}`)
		expect(getExternalTestServicesElectricShapeUrl(config)).toBe(`http://127.0.0.1:${TEST_ELECTRIC_PORT}/v1/shape`)
		expect(config.durableStreamsOrigin).toBe(`http://127.0.0.1:${TEST_DURABLE_STREAMS_PORT}`)
	})

	it('uses stack-provided project and endpoint overrides', () => {
		const env = {
			HUMANLAYER_TEST_COMPOSE_PROJECT: 'riptide-branch-test',
			HUMANLAYER_TEST_POSTGRES_ADMIN_URL: 'postgresql://postgres:secret@127.0.0.1:61001/postgres',
			HUMANLAYER_TEST_POSTGRES_DATABASE_URL_TEMPLATE: 'postgresql://postgres:secret@127.0.0.1:61001/{database}',
			HUMANLAYER_TEST_ELECTRIC_URL: 'http://127.0.0.1:61002',
			HUMANLAYER_TEST_ELECTRIC_SECRET: 'stack-secret',
			HUMANLAYER_TEST_KV_URL: 'redis://127.0.0.1:61003',
			HUMANLAYER_TEST_DURABLE_STREAMS_ORIGIN: 'http://127.0.0.1:61004',
		}
		const config = getExternalTestServicesConfig(env)

		expect(getExternalTestServicesComposeArgs(['up', '-d'], env)).toContain('riptide-branch-test')
		expect(config.postgresAdminUrl).toContain(':61001/')
		expect(config.electricUrl).toBe('http://127.0.0.1:61002')
		expect(config.kvUrl).toBe('redis://127.0.0.1:61003')
		expect(config.durableStreamsOrigin).toBe('http://127.0.0.1:61004')
	})

	it('includes recovery commands in friendly errors', () => {
		const message = formatExternalTestServicesError('boom', getExternalTestServicesConfig({}))
		const commands = getExternalTestServicesRecoveryCommands()

		expect(message).toContain('External test services are unavailable.')
		expect(message).toContain('boom')
		expect(message).toContain(commands.up)
		expect(message).toContain(commands.down)
		expect(message).toContain(commands.logs)
	})

	it('fails early when services are unavailable', async () => {
		const config = getExternalTestServicesConfig({
			HUMANLAYER_TEST_POSTGRES_ADMIN_URL: 'postgresql://postgres:bad@127.0.0.1:1/postgres',
			HUMANLAYER_TEST_POSTGRES_DATABASE_URL_TEMPLATE: 'postgresql://postgres:bad@127.0.0.1:1/{database}',
			HUMANLAYER_TEST_ELECTRIC_URL: 'http://127.0.0.1:1',
			HUMANLAYER_TEST_ELECTRIC_SECRET: 'secret',
		})

		await expect(
			waitForExternalTestServices(config, {
				timeoutMs: 10,
				intervalMs: 1,
			}),
		).rejects.toThrow('External test services are unavailable.')
	})
})
