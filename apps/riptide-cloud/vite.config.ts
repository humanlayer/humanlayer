import { resolve } from 'node:path'

import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
	const env = { ...loadEnv(mode, resolve(__dirname, '../..'), ''), ...process.env }

	// Validate required env vars for production builds
	if (mode === 'production') {
		const required = ['VITE_PUBLIC_RIPTIDE_API_ORIGIN', 'VITE_PUBLIC_SYNC_ORIGIN', 'VITE_PUBLIC_WORKOS_CLIENT_ID']
		const missing = required.filter((key) => !env[key])
		if (missing.length > 0) {
			throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
		}

		// Set by Pulumi in a real build, but not fatal when absent — each has a
		// defined fallback. They are listed so a wiring regression is VISIBLE:
		// without VITE_PUBLIC_APP_ORIGIN every task link silently reverts to the
		// in-app artifacts route, which is the bug this list exists to catch.
		const optional = ['VITE_PUBLIC_BILLING_ENFORCEMENT_ENABLED', 'VITE_PUBLIC_APP_ORIGIN']
		const missingOptional = optional.filter((key) => !env[key])
		if (missingOptional.length > 0) {
			console.warn(`Optional environment variables not set: ${missingOptional.join(', ')}`)
		}
	}

	const plugins = [TanStackRouterVite({ autoCodeSplitting: true }), react(), tailwindcss()]

	// Source map upload — pattern from riptide-ui vite.config.ts:40-55
	if (mode === 'production' && env.SENTRY_ORG && env.SENTRY_PROJECT && env.SENTRY_AUTH_TOKEN) {
		plugins.push(
			// @ts-expect-error - Vite plugin type compatibility issue
			sentryVitePlugin({
				org: env.SENTRY_ORG,
				project: env.SENTRY_PROJECT,
				authToken: env.SENTRY_AUTH_TOKEN,
				release: {
					name: env.VITE_PUBLIC_BUILD_VERSION || 'dev',
				},
				sourcemaps: {
					filesToDeleteAfterUpload: ['**/*.js.map', '**/*.mjs.map'],
				},
			}),
		)
	}

	return {
		plugins,
		resolve: {
			alias: {
				'@': resolve(__dirname, './src'),
			},
		},
		server: {
			host: '127.0.0.1',
			port: Number(process.env.RIPTIDE_CLOUD_PORT) || 5174,
			strictPort: true,
		},
		build: {
			sourcemap: mode === 'production',
			rollupOptions: {
				output: { sourcemapExcludeSources: true },
			},
		},
	}
})
