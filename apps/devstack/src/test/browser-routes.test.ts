import { describe, expect, it, vi } from 'vitest'

import { renderCaddyConfig } from '../lib/caddy'
import { renderStackEnvLines } from '../lib/env-block'
import { createApiManifest, createElectricManifest, createPostgresManifest } from '../lib/manifest'
import type { StackRecord } from '../lib/registry'
import { createStackRoutes } from '../lib/routes'
import { waitForWebRoute } from '../lib/web-readiness'

function stack(id: string, ui: number, cloud: number): StackRecord {
	const routes = createStackRoutes(id)
	const ports = {
		ui,
		cloud,
		api: ui + 2,
		electricProxy: ui + 3,
		docs: ui + 4,
		adminApi: ui + 5,
		adminUi: ui + 6,
		postgres: ui + 7,
		electric: ui + 8,
		rivetEngine: ui + 9,
		rivetServices: ui + 10,
		minioApi: ui + 11,
		minioConsole: ui + 12,
		tanstackDevtools: ui + 13,
		testPostgres: ui + 14,
		testElectric: ui + 15,
		testRivetEngine: ui + 16,
		testRivetServices: ui + 17,
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
		}),
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
	}
}

describe.skipIf(Boolean(process.env.CI))('Riptide browser stack routes', () => {
	it('projects dedicated web ports, browser origins, and the stack sync origin', () => {
		const record = stack('web-a', 43100, 43101)
		const lines = renderStackEnvLines(record, '/tmp/registry.json')

		expect(lines).toContain('RIPTIDE_UI_PORT=43100')
		expect(lines).toContain('RIPTIDE_CLOUD_PORT=43101')
		expect(lines).toContain(`RIPTIDE_UI_TANSTACK_DEVTOOLS_PORT=${record.ports.tanstackDevtools}`)
		expect(lines).toContain('VITE_PUBLIC_RIPTIDE_API_ORIGIN=https://api.web-a.localhost')
		expect(lines).toContain('VITE_PUBLIC_DEEP_LINK_SCHEME=riptide-local-web-a')
		expect(lines).toContain('VITE_PUBLIC_CLOUD_ORIGIN=https://cloud.web-a.localhost')
		expect(lines).toContain('CLOUD_ORIGIN=https://cloud.web-a.localhost')
		expect(lines).toContain('VITE_ADMIN_API_ORIGIN=https://admin-api.web-a.localhost')
		expect(lines).toContain('APP_ORIGIN=https://app.web-a.localhost')
		expect(lines).toContain('VITE_PUBLIC_SYNC_ORIGIN=https://sync.web-a.localhost')
	})

	it('routes two stacks to their own UI and cloud backends', () => {
		const config = renderCaddyConfig([stack('web-a', 43100, 43101), stack('web-b', 43200, 43201)])

		for (const expected of [
			'https://app.web-a.localhost {',
			'reverse_proxy 127.0.0.1:43100',
			'https://cloud.web-a.localhost {',
			'reverse_proxy 127.0.0.1:43101',
			'https://app.web-b.localhost {',
			'reverse_proxy 127.0.0.1:43200',
			'https://cloud.web-b.localhost {',
			'reverse_proxy 127.0.0.1:43201',
		]) {
			expect(config).toContain(expected)
		}
	})

	it('waits for a browser route without contacting sync', async () => {
		const fetchRoute = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 503 }))
			.mockResolvedValueOnce(new Response('ok'))
		await waitForWebRoute('https://app.web-a.localhost', {
			intervalMs: 0,
			fetch: fetchRoute as unknown as typeof fetch,
		})
		expect(fetchRoute).toHaveBeenCalledTimes(2)
		expect(fetchRoute).toHaveBeenCalledWith('https://app.web-a.localhost')
	})
})
