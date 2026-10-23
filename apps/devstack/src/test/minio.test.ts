import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createComposeTeardownCommands } from '../lib/compose'
import { renderStackEnvLines } from '../lib/env-block'
import {
	createApiManifest,
	createElectricManifest,
	createMinioManifest,
	createPostgresManifest,
	createRivetManifest,
} from '../lib/manifest'
import { waitForMinio } from '../lib/minio-readiness'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'

function createStack(): StackRecord {
	const id = 'minio-a'
	const composeProject = `riptide-${id}`
	const routes = createStackRoutes(id)
	const ports = {
		ui: 45000,
		cloud: 45001,
		api: 45002,
		electricProxy: 45003,
		docs: 45004,
		adminApi: 45005,
		adminUi: 45006,
		postgres: 45007,
		electric: 45008,
		rivetEngine: 45009,
		rivetServices: 45010,
		minioApi: 45011,
		minioConsole: 45012,
		tanstackDevtools: 45013,
		testPostgres: 45014,
		testElectric: 45015,
		testRivetEngine: 45016,
		testRivetServices: 45017,
	}
	return {
		id,
		displayName: id,
		worktreePath: '/tmp/minio-a',
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
		minio: createMinioManifest({ composeProject, apiPort: ports.minioApi, consolePort: ports.minioConsole }),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe.skipIf(Boolean(process.env.CI))('MinIO stack isolation', () => {
	it('projects stack ports, storage, bucket, endpoint, and credentials', () => {
		const lines = renderStackEnvLines(createStack(), '/tmp/registry.json')
		expect(lines).toContain('DEVSTACK_MINIO_API_PORT=45011')
		expect(lines).toContain('DEVSTACK_MINIO_CONSOLE_PORT=45012')
		expect(lines).toContain('DEVSTACK_MINIO_VOLUME=riptide-minio-a-minio')
		expect(lines).toContain('S3_ARTIFACTS_ENDPOINT=https://s3.minio-a.localhost')
		expect(lines).toContain('S3_ARTIFACTS_BUCKET=riptide-artifacts')
		expect(lines).toContain('S3_ACCESS_KEY_ID=minioadmin')
		expect(lines).toContain('S3_SECRET_ACCESS_KEY=minioadmin')
	})

	it('parameterizes committed Compose MinIO resources', async () => {
		const compose = await readFile(resolve(process.cwd(), '../../docker-compose.yaml'), 'utf8')
		expect(compose).toContain('${DEVSTACK_MINIO_API_PORT:-9000}:9000')
		expect(compose).toContain('${DEVSTACK_MINIO_CONSOLE_PORT:-9001}:9001')
		expect(compose).toContain('${S3_ARTIFACTS_BUCKET:-riptide-artifacts}')
		expect(compose).toContain('name: ${DEVSTACK_MINIO_VOLUME:-electric_quickstart_minio_data}')
	})

	it('waits for the configured bucket and reports useful failures', async () => {
		const stack = createStack()
		const send = vi.fn().mockResolvedValue({})
		await waitForMinio(stack.minio!, { createClient: () => ({ send }) as never })
		expect(send).toHaveBeenCalledOnce()

		await expect(
			waitForMinio(stack.minio!, {
				timeoutMs: 1,
				intervalMs: 0,
				createClient: () => ({ send: vi.fn().mockRejectedValue(new Error('NoSuchBucket')) }) as never,
			}),
		).rejects.toThrow('MinIO bucket riptide-artifacts did not become ready at http://127.0.0.1:45011')
	})

	it('uses stack-scoped Compose teardown with volumes', () => {
		const development = createComposeTeardownCommands(createStack())[0]
		expect(development?.args).toContain('--volumes')
		expect(development?.args).toContain('riptide-minio-a')
	})
})
