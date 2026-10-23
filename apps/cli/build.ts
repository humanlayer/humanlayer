import { parseArgs } from 'node:util'

import { embedPhotonWasmPlugin } from '../../scripts/bun-build-plugins/embed-photon-wasm'

const TARGETS = {
	'darwin-arm64': { target: 'bun-darwin-arm64' as Bun.Build.CompileTarget, outfile: 'dist/humanlayer-darwin-arm64' },
	'darwin-x64': {
		target: 'bun-darwin-x64-baseline' as Bun.Build.CompileTarget,
		outfile: 'dist/humanlayer-darwin-x64',
	},
	'linux-arm64': { target: 'bun-linux-arm64' as Bun.Build.CompileTarget, outfile: 'dist/humanlayer-linux-arm64' },
	'linux-x64': { target: 'bun-linux-x64-baseline' as Bun.Build.CompileTarget, outfile: 'dist/humanlayer-linux-x64' },
	'win32-x64': {
		target: 'bun-windows-x64-baseline' as Bun.Build.CompileTarget,
		outfile: 'dist/humanlayer-win32-x64.exe',
	},
} as const

type TargetKey = keyof typeof TARGETS

const { values } = parseArgs({
	options: {
		target: { type: 'string' },
		all: { type: 'boolean', default: false },
	},
})

// Environment config is now handled by Bun macros (src/lib/macros/).
// The macros read BETA_* and PROD_* env vars at build time.
// No `define` entries needed — macros are resolved during compilation.
const define: Record<string, string> = {}

// This binary embeds the daemon, so it bakes the daemon's origin macros too — and it does so
// without running apps/riptide-daemon/build.ts, which is where those are otherwise enforced.
// A release (BUILD_TYPE set) must carry all of them; a bare local build stays unguarded.
if (process.env.BUILD_TYPE) {
	for (const key of [
		'RIPTIDE_DAEMON_API_ORIGIN',
		'RIPTIDE_DAEMON_SYNC_ORIGIN',
		'RIPTIDE_DAEMON_CLOUD_ORIGIN',
		'RIPTIDE_DAEMON_APP_ORIGIN',
	]) {
		if (!process.env[key]) throw new Error(`Missing ${key} passed to build`)
	}
}

if (process.env.BUILD_VERSION) {
	define.__VERSION__ = JSON.stringify(process.env.BUILD_VERSION)
}

async function buildTarget(key: string, config: { target: Bun.Build.CompileTarget; outfile: string }) {
	console.error(`Building ${key}...`)
	const result = await Bun.build({
		entrypoints: ['./src/index.ts'],
		compile: { target: config.target, outfile: config.outfile },
		define,
		plugins: [embedPhotonWasmPlugin],
	})
	if (!result.success) {
		console.error(`Build failed for ${key}:`, result.logs)
		process.exit(1)
	}
	console.error(`Built ${key} -> ${config.outfile}`)
}

if (values.all) {
	await Promise.all(Object.entries(TARGETS).map(([key, config]) => buildTarget(key, config)))
} else if (values.target) {
	const key = values.target as TargetKey
	if (!(key in TARGETS)) {
		console.error(`Unknown target: ${key}`)
		console.error(`Available targets: ${Object.keys(TARGETS).join(', ')}`)
		process.exit(1)
	}
	await buildTarget(key, TARGETS[key])
} else {
	// Default: build for current platform
	const platform = process.platform
	const arch = process.arch
	const key = `${platform}-${arch === 'arm64' ? 'arm64' : 'x64'}` as TargetKey
	if (key in TARGETS) {
		await buildTarget(key, TARGETS[key])
	} else {
		console.error(`No target configured for ${platform}-${arch}`)
		process.exit(1)
	}
}
