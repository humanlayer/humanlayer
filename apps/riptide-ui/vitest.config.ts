import { fileURLToPath, URL } from 'node:url'

import { dom } from '@humanlayer/vitest-config'
import { defineConfig, mergeConfig } from 'vitest/config'

export default mergeConfig(
	dom,
	defineConfig({
		define: {
			'import.meta.env.VITE_PUBLIC_SYNC_ORIGIN': JSON.stringify('http://localhost:5133'),
		},
		resolve: {
			alias: {
				'@': fileURLToPath(new URL('./src', import.meta.url)),
			},
		},
		test: {
			environment: 'jsdom',
			include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
			server: {
				deps: {
					inline: ['vim-prose'],
				},
			},
			setupFiles: ['./test/setup/vitest.ts'],
		},
	}),
)
