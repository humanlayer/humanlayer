import { describe, expect, it, vi } from 'vitest'

import { renderCaddyConfig } from '../lib/caddy'
import { renderStackEnvLines } from '../lib/env-block'
import {
	createApiManifest,
	createElectricManifest,
	createPostgresManifest,
	createTestServicesManifest,
} from '../lib/manifest'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'
import { waitForElectric, waitForElectricProxy } from '../lib/sync-readiness'

function stack(id: string, basePort: number): StackRecord {
	const routes = createStackRoutes(id)
	const ports = {
		ui: basePort,
		cloud: basePort + 1,
		api: basePort + 2,
		electricProxy: basePort + 3,
		docs: basePort + 4,
		adminApi: basePort + 5,
		adminUi: basePort + 6,
		postgres: basePort + 7,
		electric: basePort + 8,
		rivetEngine: basePort + 9,
		rivetServices: basePort + 10,
		minioApi: basePort + 11,
		minioConsole: basePort + 12,
		tanstackDevtools: basePort + 13,
		testPostgres: basePort + 14,
		testElectric: basePort + 15,
		testRivetEngine: basePort + 16,
		testRivetServices: basePort + 17,
	}
	return {
		id,
		displayName: id,
		worktreePath: `/tmp/${id}`,
		composeProject: `riptide-${id}`,
		tauriSuffix: id,
		ports,
		routes,
		postgres: createPostgresManifest({ composeProject: `riptide-${id}`, postgresPort: ports.postgres }),
		api: createApiManifest(ports.api, routes.api),
		electric: createElectricManifest({
			stackId: id,
			electricPort: ports.electric,
			electricProxyPort: ports.electricProxy,
			electricSecret: `secret-${id}`,
		}),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe.skipIf(Boolean(process.env.CI))('stack sync route', () => {
	it('projects Electric and proxy configuration with the real sync origin', () => {
		const record = stack('sync-a', 44000)
		const lines = renderStackEnvLines(record, '/tmp/registry.json')
		expect(lines).toContain('DEVSTACK_ELECTRIC_PORT=44008')
		expect(lines).toContain('DEVSTACK_ELECTRIC_SECRET=secret-sync-a')
		expect(lines).toContain('DEVSTACK_ELECTRIC_REPLICATION_STREAM_ID=sync_a')
		expect(lines).toContain('RIPTIDE_ELECTRIC_PROXY_PORT=44003')
		expect(lines).toContain('ELECTRIC_SHAPE_URL=http://127.0.0.1:44008/v1/shape')
		expect(lines).toContain('VITE_PUBLIC_SYNC_ORIGIN=https://sync.sync-a.localhost')
		expect(lines).toContain('RIPTIDE_SYNC_ORIGIN=https://sync.sync-a.localhost')
	})

	it('uses a Postgres-identifier-safe replication stream ID', () => {
		const record = stack('devstack-auth-verification', 44000)
		expect(record.electric.electricReplicationStreamId).toBe('devstack_auth_verification')
		expect(record.electric.electricReplicationStreamId).toMatch(/^[a-z_][a-z0-9_$]*$/)
	})

	it('bounds long replication stream IDs for Electric publication names', () => {
		const record = stack('multi-instance-dev-stack-isolation-architecture', 44000)
		const other = stack('multi-instance-dev-stack-isolation-architecture-other', 45000)
		const testServices = createTestServicesManifest({
			stackId: record.id,
			composeProject: record.composeProject,
			postgresPort: record.ports.testPostgres,
			electricPort: record.ports.testElectric,
			rivetEnginePort: record.ports.testRivetEngine,
			rivetServicesPort: record.ports.testRivetServices,
			redisPort: 46000,
		})
		expect(record.electric.electricReplicationStreamId.length).toBeLessThanOrEqual(42)
		expect(record.electric.electricReplicationStreamId).toMatch(/^[a-z_][a-z0-9_$]*$/)
		expect(other.electric.electricReplicationStreamId).not.toBe(record.electric.electricReplicationStreamId)
		expect(testServices.electricReplicationStreamId.length).toBeLessThanOrEqual(42)
	})

	it('separates two streaming proxy backends and emits streaming directives', () => {
		const config = renderCaddyConfig([stack('sync-a', 44000), stack('sync-b', 45000)])
		expect(config).toContain('https://sync.sync-a.localhost {')
		expect(config).toContain('reverse_proxy 127.0.0.1:44003')
		expect(config).toContain('https://sync.sync-b.localhost {')
		expect(config).toContain('reverse_proxy 127.0.0.1:45003')
		expect(config).toContain('flush_interval -1')
		expect(config).toContain('Cache-Control "no-cache, no-transform"')
		expect(config).toContain('X-Accel-Buffering "no"')
	})

	it('actively checks Electric and proxy endpoints', async () => {
		const fetchEndpoint = vi.fn().mockResolvedValue(new Response('ok'))
		await waitForElectric(44008, { fetch: fetchEndpoint as unknown as typeof fetch })
		await waitForElectricProxy(44003, { fetch: fetchEndpoint as unknown as typeof fetch })
		expect(fetchEndpoint).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:44008/v1/health')
		expect(fetchEndpoint).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:44003/')
	})
})
