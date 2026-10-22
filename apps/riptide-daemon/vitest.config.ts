import { resolve } from 'node:path'

import { base } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

const bunFileImportForVitest = () => ({
	name: 'bun-file-import-for-vitest',
	enforce: 'pre' as const,
	transform(code: string, id: string) {
		if (
			!id.includes('/src/plugins/bundled-humanlayer-plugin.ts') &&
			!id.includes('/src/plugins/bundled-rpi-plugin.ts')
		) {
			return null
		}

		const transformed = code.replace(
			/import (\w+) from '([^']+)' with \{[\s\S]*?type:\s*'file',?[\s\S]*?\}/g,
			"const $1 = __vitestFileResolve(import.meta.dirname, '$2')",
		)

		return {
			code: `import { resolve as __vitestFileResolve } from 'node:path'\n${transformed}`,
			map: null,
		}
	},
})

export default mergeConfig(
	base,
	defineConfig({
		root: import.meta.dirname,
		plugins: [bunFileImportForVitest()],
		test: {
			testTimeout: 120_000,
			// The origin macros read env at import (vitest does not expand `with { type: 'macro' }`),
			// so pin them here: tests assert against these instead of whatever the developer's .env
			// happens to hold, and the app/cloud pair stays distinguishable. The runtime override
			// (`RIPTIDE_APP_ORIGIN`, which wins over the macro) is pinned to the same value — a
			// dev .env carrying its own would otherwise decide what the assertions see.
			env: {
				IS_BILLING_ENFORCEMENT_ENABLED: 'false',
				RIPTIDE_DAEMON_APP_ORIGIN: 'https://app.vitest.test',
				RIPTIDE_APP_ORIGIN: 'https://app.vitest.test',
				RIPTIDE_DAEMON_CLOUD_ORIGIN: 'https://cloud.vitest.test',
				// The database project imports riptide-api code that requires these at module load.
				// Load-time placeholders only, as in riptide-api's vitest config.
				WORKOS_API_KEY: process.env.WORKOS_API_KEY || 'sk_test',
				WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID || 'client_test',
				WORKOS_REDIRECT_URI: process.env.WORKOS_REDIRECT_URI || 'http://localhost/callback',
			},
			projects: [
				{
					extends: true,
					test: {
						name: 'unit',
						include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'test/effect/**/*.vi.test.ts'],
						exclude: [
							'test/learning/**',
							'test/integration/**',
							'test/database/**',
							'test/effect/fold-event-log-session.vi.test.ts',
							'test/effect/fold-session-launch.vi.test.ts',
							'test/effect/fold-streaming.vi.test.ts',
						],
						maxWorkers: 4,
					},
				},
				{
					extends: true,
					test: {
						name: 'database',
						include: [
							'test/database/**/*.test.ts',
							'test/effect/fold-event-log-session.vi.test.ts',
							'test/effect/fold-session-launch.vi.test.ts',
							'test/effect/fold-streaming.vi.test.ts',
						],
						testTimeout: 120_000,
					},
				},
				{
					extends: true,
					test: {
						name: 'integration',
						include: ['test/integration/**/*.test.ts'],
						testTimeout: 120_000,
					},
				},
				{
					extends: true,
					test: {
						name: 'learning',
						include: ['test/learning/**/*.test.ts'],
						testTimeout: 180_000,
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
