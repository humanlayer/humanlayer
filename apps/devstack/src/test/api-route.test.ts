import { describe, expect, it } from 'vitest'

import { renderCaddyConfig } from '../lib/caddy'
import { renderStackEnvLines } from '../lib/env-block'
import { createApiManifest } from '../lib/manifest'
import { createStackRoutes } from '../lib/routes'

describe.skipIf(Boolean(process.env.CI))('Riptide API stack route', () => {
	it('projects the dedicated API port and public origins', () => {
		const lines = renderStackEnvLines(
			{
				id: 'api-test',
				composeProject: 'riptide-api-test',
				ports: { api: 43123, postgres: 43124 },
				api: createApiManifest(43123, 'https://api.api-test.localhost'),
				postgres: {
					postgresPort: 43124,
					postgresPassword: 'secret',
					postgresVolume: 'postgres',
					databaseUrl: 'postgresql://example',
					readReplicaDatabaseUrl: 'postgresql://example',
				},
			},
			'/tmp/registry.json',
		)

		expect(lines).toContain('RIPTIDE_API_PORT=43123')
		expect(lines).toContain('VITE_PUBLIC_RIPTIDE_API_ORIGIN=https://api.api-test.localhost')
		expect(lines).toContain('RIPTIDE_API_ORIGIN=https://api.api-test.localhost')
	})

	it('routes the stack API to its persisted backend without buffering', () => {
		const routes = createStackRoutes('api-test')
		const config = renderCaddyConfig([
			{
				id: 'api-test',
				routes,
				ports: { api: 43123, ui: 1, cloud: 2, electricProxy: 3, docs: 4, adminApi: 5, adminUi: 6 },
				api: createApiManifest(43123, routes.api),
			} as never,
		])

		expect(config).toContain('https://api.api-test.localhost')
		expect(config).toContain('reverse_proxy 127.0.0.1:43123')
		expect(config).toContain('flush_interval -1')
		expect(config).toContain('X-Accel-Buffering "no"')
	})
})
