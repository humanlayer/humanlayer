import { describe, expect, it, vi } from 'vitest'

import { createComposeTeardownCommands, selectedStackComposeHelp } from '../lib/compose'
import { renderStackEnvLines } from '../lib/env-block'
import { createPostgresManifest } from '../lib/manifest'
import { waitForPostgres } from '../lib/postgres'
import type { StackRecord } from '../lib/registry'
import { ORGANIZATION_SEED_SQL } from '../lib/seed'

describe.skipIf(Boolean(process.env.CI))('Postgres stack configuration', () => {
	it('creates encoded database URLs and stable persisted values', () => {
		const manifest = createPostgresManifest({
			composeProject: 'riptide-alpha',
			postgresPort: 55491,
			postgresPassword: 'special:/ password',
			postgresVolume: 'riptide-alpha-postgres',
		})
		expect(manifest.databaseUrl).toBe('postgresql://postgres:special%3A%2F%20password@127.0.0.1:55491/electric')
		expect(manifest.readReplicaDatabaseUrl).toBe(manifest.databaseUrl)
	})

	it('renders Compose and application Postgres environment values', () => {
		const postgres = createPostgresManifest({
			composeProject: 'riptide-alpha',
			postgresPort: 55491,
			postgresPassword: 'secret',
		})
		const lines = renderStackEnvLines(
			{ id: 'alpha', composeProject: 'riptide-alpha', ports: { postgres: 55491 }, postgres },
			'/tmp/registry.json',
		)
		expect(lines).toContain('DEVSTACK_COMPOSE_PROJECT=riptide-alpha')
		expect(lines).toContain('DEVSTACK_POSTGRES_PORT=55491')
		expect(lines).toContain('DEVSTACK_POSTGRES_PASSWORD=secret')
		expect(lines).toContain('DEVSTACK_POSTGRES_VOLUME=riptide-alpha-postgres')
		expect(lines).toContain(`DATABASE_URL=${postgres.databaseUrl}`)
	})

	it('uses a parameterized idempotent organization upsert', () => {
		expect(ORGANIZATION_SEED_SQL).toContain('VALUES ($1, $2, $3)')
		expect(ORGANIZATION_SEED_SQL).toContain('ON CONFLICT (id) DO UPDATE')
	})

	it('reports a redacted readiness failure', async () => {
		const check = vi.fn().mockRejectedValue(new Error('connection refused'))
		await expect(
			waitForPostgres('postgresql://postgres:secret@127.0.0.1:1/electric', {
				timeoutMs: 5,
				intervalMs: 1,
				check,
			}),
		).rejects.toThrow('postgresql://postgres:***@127.0.0.1:1/electric')
	})

	it('keeps native Compose guidance and scoped volume teardown', () => {
		const postgres = createPostgresManifest({ composeProject: 'riptide-alpha', postgresPort: 55491 })
		const stack = {
			id: 'alpha',
			worktreePath: '/tmp/alpha',
			composeProject: 'riptide-alpha',
			postgres,
		} as StackRecord
		expect(selectedStackComposeHelp(stack)).toContain('docker compose up -d postgres')
		const development = createComposeTeardownCommands(stack)[0]
		expect(development).toBeDefined()
		if (!development) throw new Error('Missing development Compose teardown command')
		expect(development.args).toContain('riptide-alpha')
		expect(development.args).toContain('--volumes')
	})
})
