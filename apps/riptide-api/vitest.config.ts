import { resolve } from 'node:path'

import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

const defaultDatabaseUrl = 'postgresql://postgres:humanlayer_test_password@127.0.0.1:55432/electric'

export default mergeConfig(
	base,
	defineConfig({
		test: {
			env: {
				DATABASE_URL: process.env.DATABASE_URL ?? defaultDatabaseUrl,
				IS_BILLING_ENFORCEMENT_ENABLED: 'false',
				READ_REPLICA_DATABASE_URL:
					process.env.READ_REPLICA_DATABASE_URL ?? process.env.DATABASE_URL ?? defaultDatabaseUrl,
				// app-runtime (src/effects/app-runtime.ts) builds the live Effect S3 + WorkOS services at
				// module load via requireEnvironment(), so any suite importing a procedure / effect-base
				// throws at collection time without these. Tests that exercise S3/WorkOS inject fake service
				// layers, so these are load-time placeholders only — real values from the env still win.
				S3_ARTIFACTS_BUCKET: process.env.S3_ARTIFACTS_BUCKET ?? 'test-artifacts',
				WORKOS_API_KEY: process.env.WORKOS_API_KEY || 'sk_test',
				WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID || 'client_test',
				WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI || 'http://localhost/callback',
			},
			testTimeout: 15_000,
			// Default serial; the `unit` project opts into parallelism below. maxWorkers
			// only takes effect when fileParallelism is true (the unit project); when
			// fileParallelism is false Vitest forces maxWorkers to 1.
			fileParallelism: false,
			maxWorkers: 4,
			projects: [
				{
					extends: true,
					test: {
						name: 'unit',
						include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/effect/**/*.vi.test.ts'],
						setupFiles: ['test/utils/setup-unit.ts'],
						exclude: [
							'test/learning/**',
							'test/procedures/events-create-status-advance.test.ts',
							'test/procedures/tasks-create-title-generation.test.ts',
						],
						globalSetup: ['test/utils/global-setup.ts'],
						// Each unit test file provisions its own unique random Postgres
						// database (see test/utils/test-db.ts), so files are safe to run in
						// parallel. Bounded to 4 workers to keep connection/CREATE-DROP-DATABASE
						// pressure well under postgres max_connections (500).
						fileParallelism: true,
						isolate: false,
					},
				},
				{
					extends: true,
					test: {
						name: 'unit-isolated',
						include: [
							'test/procedures/events-create-status-advance.test.ts',
							// Its @humanlayer/ai vi.mock needs a fresh module registry; the
							// shared `unit` registry (isolate: false) applies mocks
							// order-dependently across files.
							'test/procedures/tasks-create-title-generation.test.ts',
						],
						globalSetup: ['test/utils/global-setup.ts'],
					},
				},
				{
					extends: true,
					test: {
						name: 'learning',
						include: ['test/learning/**/*.test.ts'],
						testTimeout: 120_000,
					},
				},
			],
		},
		resolve: {
			alias: {
				'@': resolve(import.meta.dirname, 'src'),
			},
		},
	}),
)
