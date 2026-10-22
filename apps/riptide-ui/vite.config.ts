import { fileURLToPath, URL } from 'node:url'

import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type PluginOption } from 'vite'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/+$/, '')
const env = { ...loadEnv(process.env.NODE_ENV ?? 'development', repoRoot, ''), ...process.env }
const isElectronPackageBuild = env.RIPTIDE_ELECTRON_PACKAGE_BUILD === 'true'

const electronContentSecurityPolicy = [
	"default-src 'self'",
	"script-src 'self' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data: https://fonts.gstatic.com",
	"connect-src 'self' https: wss:",
	"worker-src 'self' blob:",
	"frame-src 'self' blob: https://*.s3.us-east-1.amazonaws.com https://s3.us-east-1.amazonaws.com https://*.s3.amazonaws.com https://s3.amazonaws.com",
	"child-src 'self' blob:",
	"media-src 'self' data: blob: https:",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self' https:",
].join('; ')
const electronContentSecurityPolicyTag = {
	tag: 'meta',
	attrs: {
		'http-equiv': 'Content-Security-Policy',
		content: electronContentSecurityPolicy,
	},
	injectTo: 'head-prepend',
} as const

// Sentry source-map upload needs all three of these; a partial config silently misconfigures upload.
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

const plugins: PluginOption[] = [
	{
		name: 'electron-content-security-policy',
		transformIndexHtml: {
			order: 'pre',
			handler: () => (isElectronPackageBuild ? [electronContentSecurityPolicyTag] : []),
		},
	},
	{
		// react-scan is a dev-server-only diagnostic (toolbar defaults off; toggle to
		// highlight re-renders). Alias it to a no-op stub in EVERY build so no release
		// channel pays its per-commit instrumentation cost (removed from dev-channel
		// builds in 693128207 for exactly that reason).
		name: 'disable-react-scan-in-release-builds',
		apply: (_config, { command }) => command === 'build',
		config: () => ({
			resolve: {
				alias: {
					'react-scan': fileURLToPath(new URL('./src/lib/react-scan-disabled.ts', import.meta.url)),
				},
			},
		}),
	},
	// TanStack devtools starts an event bus server on port 42069 by default.
	// Use a unique port to avoid conflicts with other vite servers (e.g. storybook).
	// See also: .storybook/main.ts which uses port 42071
	devtools({
		eventBusConfig: {
			port: Number(env.RIPTIDE_UI_TANSTACK_DEVTOOLS_PORT) || 42070,
		},
	}),
	tanstackRouter({
		target: 'react',
		autoCodeSplitting: true,
		quoteStyle: 'single',
		semicolons: false,
	}),
	viteReact({
		babel: {
			plugins: ['babel-plugin-react-compiler'],
		},
	}),
	tailwindcss(),
]

if (process.env.NODE_ENV === 'production' && sentryOrg && sentryProject && sentryAuthToken) {
	plugins.push(
		// @ts-expect-error - Vite plugin type compatibility issue with Sentry plugin
		sentryVitePlugin({
			org: sentryOrg,
			project: sentryProject,
			authToken: sentryAuthToken,

			release: {
				name: process.env.VITE_PUBLIC_BUILD_VERSION || 'dev',
			},

			sourcemaps: {
				filesToDeleteAfterUpload: ['**/*.js.map', '**/*.mjs.map'],
			},
		}),
	)
}

// https://vitejs.dev/config/
export default defineConfig({
	base: '/',
	plugins,
	resolve: {
		dedupe: ['react', 'react-dom'],
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
		},
	},
	server: {
		host: '127.0.0.1',
		port: Number(env.RIPTIDE_UI_PORT) || 3000,
		strictPort: true,
	},
	build: {
		sourcemap: process.env.NODE_ENV === 'production',
		rollupOptions: {
			output: {
				sourcemapExcludeSources: true,
			},
		},
	},
	worker: {
		// Pierre's highlighter worker imports its wasm chunk, which needs
		// module workers; the default iife format rejects code-splitting.
		format: 'es',
	},
	envDir: '../../',
})
