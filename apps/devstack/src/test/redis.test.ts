import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { renderStackEnvLines } from '../lib/env-block'
import { createRedisManifest } from '../lib/manifest'
import { ensureAvailablePort } from '../lib/ports'

describe.skipIf(Boolean(process.env.CI))('stack Redis configuration', () => {
	it('allocates and repairs one standalone port around reservations', async () => {
		const initial = await ensureAvailablePort(undefined, new Set())
		const repaired = await ensureAvailablePort(initial, new Set([initial]))
		expect(repaired).not.toBe(initial)
	})

	it('renders one standalone Redis URL, port, and volume', () => {
		const redis = createRedisManifest({
			composeProject: 'riptide-red',
			port: 22000,
		})
		const lines = renderStackEnvLines(
			{
				id: 'red',
				composeProject: 'riptide-red',
				ports: {
					api: 1,
					ui: 2,
					cloud: 3,
					tanstackDevtools: 4,
					electric: 5,
					electricProxy: 6,
					rivetEngine: 7,
					rivetServices: 8,
					minioApi: 9,
					minioConsole: 10,
				},
				postgres: {
					postgresPort: 10,
					postgresPassword: 'password',
					postgresVolume: 'postgres',
					databaseUrl: 'postgres://db',
					readReplicaDatabaseUrl: 'postgres://db',
				},
				redis,
			},
			'/tmp/registry.json',
		)
		expect(lines).toContain('DEVSTACK_REDIS_PORT=22000')
		expect(lines).toContain('DEVSTACK_REDIS_VOLUME=riptide-red-redis')
		expect(lines).toContain('KV_URL=redis://127.0.0.1:22000')
		expect(lines.some((line) => line.includes('NAT_MAP'))).toBe(false)
	})

	it('parameterizes one Redis service and named volume in Compose', async () => {
		const compose = await readFile(resolve(import.meta.dirname, '../../../../docker-compose.yaml'), 'utf8')
		expect(compose).toContain('DEVSTACK_REDIS_PORT')
		expect(compose).toContain('DEVSTACK_REDIS_VOLUME')
		expect(compose).not.toContain('REDIS_NODE_')
		expect(compose).not.toContain('REDIS_SUBNET')
	})
})
