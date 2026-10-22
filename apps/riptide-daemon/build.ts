import { embedPhotonWasmPlugin } from '../../scripts/bun-build-plugins/embed-photon-wasm'

const BUILD_TYPE = process.env.BUILD_TYPE
const RIPTIDE_DAEMON_API_ORIGIN = process.env.RIPTIDE_DAEMON_API_ORIGIN
const RIPTIDE_DAEMON_SYNC_ORIGIN = process.env.RIPTIDE_DAEMON_SYNC_ORIGIN
const RIPTIDE_DAEMON_APP_ORIGIN = process.env.RIPTIDE_DAEMON_APP_ORIGIN

if (!BUILD_TYPE) throw new Error('Missing BUILD_TYPE passed to build.ts')
if (!RIPTIDE_DAEMON_API_ORIGIN) throw new Error('Missing RIPTIDE_DAEMON_API_ORIGIN passed to build')
if (!RIPTIDE_DAEMON_SYNC_ORIGIN) throw new Error('Missing RIPTIDE_DAEMON_SYNC_ORIGIN passed to build')
if (!RIPTIDE_DAEMON_APP_ORIGIN) throw new Error('Missing RIPTIDE_DAEMON_APP_ORIGIN passed to build')

const result = await Bun.build({
	entrypoints: ['src/daemon.ts'],
	target: 'bun',
	sourcemap: 'linked',
	plugins: [embedPhotonWasmPlugin],
	compile: {
		outfile: `dist/daemon`,
	},
})

// Check for build errors
if (!result.success) {
	console.error('Build failed:', result.logs)
	process.exit(1)
}
