import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { createComposeTeardownCommands } from '../lib/compose'
import { renderStackEnvLines } from '../lib/env-block'
import { createTestServicesManifest } from '../lib/manifest'

describe.skipIf(Boolean(process.env.CI))('stack-scoped test services', () => {
	it('renders isolated Compose and fixture configuration', async () => {
		const testServices = createTestServicesManifest({
			stackId: 'branch-a',
			composeProject: 'riptide-branch-a',
			postgresPort: 61001,
			electricPort: 61002,
			rivetEnginePort: 61003,
			rivetServicesPort: 61004,
			redisPort: 61010,
		})
		const lines = renderStackEnvLines(
			{
				id: 'branch-a',
				composeProject: 'riptide-branch-a',
				ports: { api: 60000 } as never,
				postgres: {
					postgresPort: 60001,
					postgresPassword: 'dev-secret',
					postgresVolume: 'dev-postgres',
					databaseUrl: 'postgresql://dev',
					readReplicaDatabaseUrl: 'postgresql://dev',
				},
				testServices,
			},
			'/tmp/registry.json',
		)

		expect(lines).toContain('HUMANLAYER_TEST_COMPOSE_PROJECT=riptide-branch-a-test')
		expect(lines).toContain('DEVSTACK_TEST_POSTGRES_PORT=61001')
		expect(lines).toContain('HUMANLAYER_TEST_ELECTRIC_URL=http://127.0.0.1:61002')
		expect(lines).toContain('HUMANLAYER_TEST_KV_URL=redis://127.0.0.1:61010')
		expect(lines).toContain('DEVSTACK_TEST_REDIS_PORT=61010')
		expect(lines).toContain('DEVSTACK_TEST_DURABLE_STREAMS_PORT=61004')
		expect(lines).toContain('HUMANLAYER_TEST_DURABLE_STREAMS_ORIGIN=http://127.0.0.1:61004')
		expect(lines.some((line) => line.includes('NAT_MAP'))).toBe(false)

		const compose = await readFile(new URL('../../../../docker-compose.test.yml', import.meta.url), 'utf8')
		expect(compose).toContain('${HUMANLAYER_TEST_COMPOSE_PROJECT:-humanlayer_test}')
		expect(compose).toContain('${DEVSTACK_TEST_REDIS_PORT:-17000}')
		expect(compose).toContain('${DEVSTACK_TEST_DURABLE_STREAMS_PORT:-18642}:4437')
	})

	it('tears down the manifest test project separately from development', () => {
		const commands = createComposeTeardownCommands({
			worktreePath: '/tmp/branch-a',
			composeProject: 'riptide-branch-a',
			testServices: { composeProject: 'riptide-branch-a-test' },
		} as never)

		expect(commands.map((command) => command.args.join(' '))).toEqual([
			expect.stringContaining('-p riptide-branch-a down --volumes --remove-orphans'),
			expect.stringContaining('-p riptide-branch-a-test down --volumes --remove-orphans'),
		])
	})
})
