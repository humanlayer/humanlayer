import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const environmentKeys = [
	'BETA_WORKOS_CLIENT_ID',
	'BETA_API_ORIGIN',
	'BETA_SYNC_ORIGIN',
	'BETA_CLOUD_ORIGIN',
	'BETA_APP_ORIGIN',
	'PROD_WORKOS_CLIENT_ID',
	'PROD_API_ORIGIN',
	'PROD_SYNC_ORIGIN',
	'PROD_CLOUD_ORIGIN',
	'PROD_APP_ORIGIN',
	'RIPTIDE_API_ORIGIN',
	'RIPTIDE_SYNC_ORIGIN',
	'RIPTIDE_CLOUD_ORIGIN',
	'RIPTIDE_APP_ORIGIN',
] as const

const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))

beforeEach(() => {
	process.env.BETA_WORKOS_CLIENT_ID = 'beta-client'
	process.env.BETA_API_ORIGIN = 'https://api.beta.test'
	process.env.BETA_SYNC_ORIGIN = 'https://sync.beta.test'
	process.env.BETA_CLOUD_ORIGIN = 'https://cloud.beta.test'
	process.env.BETA_APP_ORIGIN = 'https://app.beta.test'
	process.env.PROD_WORKOS_CLIENT_ID = 'prod-client'
	process.env.PROD_API_ORIGIN = 'https://api.prod.test'
	process.env.PROD_SYNC_ORIGIN = 'https://sync.prod.test'
	process.env.PROD_CLOUD_ORIGIN = 'https://cloud.prod.test'
	process.env.PROD_APP_ORIGIN = 'https://app.prod.test'
	process.env.RIPTIDE_API_ORIGIN = 'https://api.override.test'
	process.env.RIPTIDE_SYNC_ORIGIN = 'https://sync.override.test'
	process.env.RIPTIDE_CLOUD_ORIGIN = 'https://cloud.override.test'
	process.env.RIPTIDE_APP_ORIGIN = 'https://app.override.test'
	vi.resetModules()
})

afterEach(() => {
	for (const key of environmentKeys) {
		const value = originalEnvironment.get(key)
		if (value === undefined) delete process.env[key]
		else process.env[key] = value
	}
	vi.resetModules()
})

describe('resolveEnvironmentConfigOrNull', () => {
	test('uses the selected beta origin instead of a runtime override', async () => {
		const { resolveEnvironmentConfigOrNull } = await import('../src/lib/macros')

		expect(resolveEnvironmentConfigOrNull('beta')).toMatchObject({
			apiOrigin: 'https://api.beta.test',
			syncOrigin: 'https://sync.beta.test',
			cloudOrigin: 'https://cloud.beta.test',
			appOrigin: 'https://app.beta.test',
		})
	})

	test('uses runtime endpoint overrides for local development', async () => {
		const { resolveEnvironmentConfigOrNull } = await import('../src/lib/macros')

		expect(resolveEnvironmentConfigOrNull('local')).toMatchObject({
			apiOrigin: 'https://api.override.test',
			syncOrigin: 'https://sync.override.test',
			cloudOrigin: 'https://cloud.override.test',
			appOrigin: 'https://app.override.test',
		})
	})
})
