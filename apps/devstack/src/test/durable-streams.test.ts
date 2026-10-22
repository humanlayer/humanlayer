import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { renderCaddyConfig } from '../lib/caddy'
import { createComposeTeardownCommands } from '../lib/compose'
import { renderStackEnvLines } from '../lib/env-block'
import { createApiManifest, createElectricManifest, createPostgresManifest, createRivetManifest } from '../lib/manifest'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'
import { waitForDurableStreams } from '../lib/sync-readiness'

function createStack(): StackRecord {
	const id = 'streams-a'
	const composeProject = `riptide-${id}`
	const routes = createStackRoutes(id)
	const ports = {
		ui: 44000,
		cloud: 44001,
		api: 44002,
		electricProxy: 44003,
		docs: 44004,
		adminApi: 44005,
		adminUi: 44006,
		postgres: 44007,
		electric: 44008,
		rivetEngine: 44009,
		rivetServices: 44010,
		minioApi: 44011,
		minioConsole: 44012,
		tanstackDevtools: 44013,
		testPostgres: 44014,
		testElectric: 44015,
		testRivetEngine: 44016,
		testRivetServices: 44017,
	}
	return {
		id,
		displayName: id,
		worktreePath: '/tmp/streams-a',
		composeProject,
		tauriSuffix: id,
		ports,
		routes,
		postgres: createPostgresManifest({ composeProject, postgresPort: ports.postgres }),
		api: createApiManifest(ports.api, routes.api),
		electric: createElectricManifest({
			stackId: id,
			electricPort: ports.electric,
			electricProxyPort: ports.electricProxy,
		}),
		rivet: createRivetManifest({
			composeProject,
			enginePort: ports.rivetEngine,
			servicesPort: ports.rivetServices,
		}),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe.skipIf(Boolean(process.env.CI))('durable streams stack isolation', () => {
	it('projects the stack port, volume, and proxy runtime origin', () => {
		const lines = renderStackEnvLines(createStack(), '/tmp/registry.json')
		expect(lines).toContain('DEVSTACK_DURABLE_STREAMS_PORT=44010')
		expect(lines).toContain('DEVSTACK_DURABLE_STREAMS_VOLUME=riptide-streams-a-durable-streams')
		expect(lines).toContain('DURABLE_STREAMS_ORIGIN=http://127.0.0.1:44010')
	})

	it('pins and configures the committed Compose Rust runtime', async () => {
		const compose = await readFile(resolve(process.cwd(), '../../docker-compose.yaml'), 'utf8')
		expect(compose).toContain('DURABLE_STREAMS_SOURCE_COMMIT: cebb50e49c62c534dd714ef84a8a4572e66724b2')
		expect(compose).toContain('${DEVSTACK_DURABLE_STREAMS_PORT:-8642}:4437')
		expect(compose).toContain('name: ${DEVSTACK_DURABLE_STREAMS_VOLUME:-electric_quickstart_durable-streams-data}')
		expect(compose).toContain('DS_STORAGE__MODE: file-fast')
		expect(compose).toContain('DS_LIMITS__MAX_MEMORY_BYTES: "187904819200"')
		expect(compose).toContain('DS_LIMITS__MAX_STREAM_BYTES: "104857600"')
		expect(compose).toContain('http://localhost:4437/readyz')
	})

	it('keeps streaming directives on the durable-streams-backed sync route', () => {
		const config = renderCaddyConfig([createStack()])
		expect(config).toContain('https://sync.streams-a.localhost {')
		expect(config).toContain('flush_interval -1')
		expect(config).toContain('Cache-Control "no-cache, no-transform"')
		expect(config).toContain('X-Accel-Buffering "no"')
	})

	it('checks durable streams health and tears down named project volumes', async () => {
		const fetchEndpoint = vi.fn().mockResolvedValue(new Response('ok'))
		await waitForDurableStreams(44010, { fetch: fetchEndpoint as unknown as typeof fetch })
		expect(fetchEndpoint).toHaveBeenCalledWith('http://127.0.0.1:44010/readyz')
		const development = createComposeTeardownCommands(createStack())[0]
		expect(development?.args).toContain('--volumes')
		expect(development?.args).toContain('riptide-streams-a')
	})
})
