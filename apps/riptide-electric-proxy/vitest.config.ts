import path from 'node:path'

import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

const databaseTests = [
	'test/response-editor-collaboration-*.test.ts',
	'test/daemon-token-core.test.ts',
	'test/queries.session-access.test.ts',
	'test/v1.tasks.test.ts',
	'test/v1.sessions-by-host.test.ts',
	'test/v1.tasks.$taskId.artifacts.test.ts',
	'test/v1.shared-artifacts.test.ts',
	'test/v1.shared-artifact-comments.test.ts',
	'test/v1.daemon-approvals.test.ts',
	'test/v2.*.test.ts',
	'test/v3.agent-slash-commands.test.ts',
	'test/v3.online-hosts.test.ts',
	'test/on-demand-partial-updates.test.ts',
]

export default mergeConfig(
	base,
	defineConfig({
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src'),
			},
		},
		test: {
			testTimeout: 60_000,
			projects: [
				{
					extends: true,
					test: {
						name: 'unit',
						include: ['test/**/*.test.ts'],
						exclude: databaseTests,
						maxWorkers: 8,
					},
				},
				{
					extends: true,
					test: {
						name: 'database',
						include: databaseTests,
						fileParallelism: false,
						maxWorkers: 1,
					},
				},
			],
		},
	}),
)
