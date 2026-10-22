import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runCli } from '../cli'
import { renderStackEnvLines } from '../lib/env-block'
import { createApiManifest, createElectricManifest, createPostgresManifest } from '../lib/manifest'
import {
	checkNativeStackConfig,
	createNativeStackConfig,
	nativeConfigPath,
	removeNativeStackConfig,
	writeNativeStackConfig,
} from '../lib/native-config'
import type { StackRecord } from '../lib/registry'
import { readRegistry } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'

function stack(repoRoot: string): StackRecord {
	const id = 'devstack-phase-13-native'
	const routes = createStackRoutes(id)
	const ports = {
		ui: 41001,
		cloud: 41002,
		api: 41003,
		electricProxy: 41004,
		docs: 41005,
		adminApi: 41006,
		adminUi: 41007,
		postgres: 41008,
		electric: 41009,
		rivetEngine: 41010,
		rivetServices: 41011,
		minioApi: 41012,
		minioConsole: 41013,
		tanstackDevtools: 41014,
		testPostgres: 41015,
		testElectric: 41016,
		testRivetEngine: 41017,
		testRivetServices: 41018,
	}
	return {
		id,
		displayName: 'devstack phase 13 native',
		worktreePath: repoRoot,
		composeProject: `devstk-${id}`,
		tauriSuffix: 'devstack_phase_13_native',
		nativeIcon: 'icons/devstack/icon-4.png',
		ports,
		routes,
		postgres: createPostgresManifest({ composeProject: `devstk-${id}`, postgresPort: ports.postgres }),
		api: createApiManifest(ports.api, routes.api),
		electric: createElectricManifest({
			stackId: id,
			electricPort: ports.electric,
			electricProxyPort: ports.electricProxy,
		}),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe.skipIf(Boolean(process.env.CI))('stack native config', () => {
	it('has sync generate native config with a randomly selected icon', async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), 'devstack-native-icon-'))
		const registryPath = join(repoRoot, 'registry.json')
		await mkdir(join(repoRoot, 'apps', 'riptide-native'), { recursive: true })
		const args = ['--stack', 'stable-icon', '--repo-root', repoRoot, '--global-stacks', registryPath]
		const io = { stdout: () => {}, stderr: () => {} }
		const deps = {}

		// sync owns native config generation: the tauri config file exists after the first reconcile.
		expect(await runCli(['sync', ...args], io, deps)).toBe(0)
		const selected = (await readRegistry(registryPath)).stacks['stable-icon']?.nativeIcon
		expect(selected).toMatch(/^icons\/devstack\/icon-[1-6]\.png$/)
		expect(await readFile(nativeConfigPath(repoRoot), 'utf8')).toContain('stable-icon')
	})

	it('generates isolated app identity, route-aware dev URL, and safe local updater settings', () => {
		const config = createNativeStackConfig(stack('/tmp/native'))
		expect(config.productName).toBe('devstk-devstack-phase-13-native')
		expect(config.identifier).toBe('com.humanlayer.riptide.local.devstack_phase_13_native')
		expect(config.build.devUrl).toBe('https://app.devstack-phase-13-native.localhost')
		expect(config.app.windows[0]?.title).toBe('devstk-devstack-phase-13-native')
		expect(config.app.windows[0]).toMatchObject({
			titleBarStyle: 'Overlay',
			transparent: true,
			hiddenTitle: true,
		})
		expect(config.bundle.icon).toEqual(['icons/devstack/icon-4.png'])
		expect(config.plugins['deep-link'].desktop.schemes).toEqual(['riptide-local-devstack-phase-13-native'])
		expect(config.plugins.updater.endpoints[0]).toContain('update.dev.codelayer.gg/dev')
	})

	it('projects stack identity and daemon origins', () => {
		const lines = renderStackEnvLines(stack('/tmp/native'), '/tmp/registry.json')
		expect(lines).toContain('VITE_PUBLIC_DEVSTACK_ID=devstack-phase-13-native')
		expect(lines).toContain('VITE_PUBLIC_BUILD_TYPE=local')
		expect(lines.some((line) => line.endsWith('/.humanlayer/riptide/logs/devstack-phase-13-native'))).toBe(true)
		expect(lines).toContain('DEVSTACK_NATIVE_ICON=/tmp/native/apps/riptide-native/icons/devstack/icon-4.png')
		expect(lines).toContain('RIPTIDE_DAEMON_API_ORIGIN=https://api.devstack-phase-13-native.localhost')
		expect(lines).toContain('RIPTIDE_DAEMON_SYNC_ORIGIN=https://sync.devstack-phase-13-native.localhost')
		expect(lines).toContain('RIPTIDE_DAEMON_CLOUD_ORIGIN=https://cloud.devstack-phase-13-native.localhost')
		expect(lines).toContain('RIPTIDE_DAEMON_APP_ORIGIN=https://app.devstack-phase-13-native.localhost')
		// The runtime override too: .env.example ships a generic one that the stack block must beat.
		expect(lines).toContain('RIPTIDE_APP_ORIGIN=https://app.devstack-phase-13-native.localhost')
	})

	it('detects stale config and removes generated config during teardown', async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), 'devstack-native-'))
		await mkdir(join(repoRoot, 'apps', 'riptide-native'), { recursive: true })
		const record = stack(repoRoot)
		await writeNativeStackConfig(repoRoot, record)
		await expect(checkNativeStackConfig(repoRoot, record)).resolves.toBeUndefined()

		await writeFile(nativeConfigPath(repoRoot), '{}\n')
		await expect(checkNativeStackConfig(repoRoot, record)).rejects.toThrow('stale')
		await removeNativeStackConfig(repoRoot)
		await expect(readFile(nativeConfigPath(repoRoot), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
	})
})
