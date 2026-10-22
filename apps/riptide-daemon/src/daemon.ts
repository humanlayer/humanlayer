import './instrument' // MUST BE FIRST - initializes Sentry
import 'zod/compile'
import { DaemonIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import { encodeDaemonProcessEvent } from '@humanlayer/schemas/effect/daemon/process-event'
import { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Sentry from '@sentry/bun'
import * as Schema from 'effect/Schema'

import { API_ORIGIN, SYNC_ORIGIN } from './lib/macros'
import logger from './logger'
import { startManagedDaemon } from './start'

async function main() {
	// Validate required config - fail fast if macros weren't set at build time
	const apiOrigin = API_ORIGIN
	const syncOrigin = SYNC_ORIGIN
	if (!apiOrigin) {
		throw new Error('RIPTIDE_DAEMON_API_ORIGIN was not set at build time')
	}
	if (!syncOrigin) {
		throw new Error('RIPTIDE_DAEMON_SYNC_ORIGIN was not set at build time')
	}

	const expectedIdentityEnvironmentValue = process.env.RIPTIDE_DAEMON_EXPECTED_IDENTITY
	const expectedIdentity =
		expectedIdentityEnvironmentValue === undefined
			? null
			: Schema.decodeUnknownSync(DaemonIdentity)(JSON.parse(expectedIdentityEnvironmentValue))
	// Launchers (Tauri/Electron) always set DAEMON_IDENTITY together with
	// RIPTIDE_DAEMON_EXPECTED_IDENTITY. A token without an expected identity in a
	// dev-creds environment is one leaked from a parent process (riptide-launched
	// agent shells and tmux servers carry a token for a different stack), and using
	// it makes every API call 401. Ignore it and self-sign from the dev creds.
	let token = process.env.DAEMON_IDENTITY ?? null
	if (token !== null && expectedIdentity === null && process.env.RIPTIDE_DAEMON_LOAD_CREDS) {
		logger.warn('Ignoring inherited DAEMON_IDENTITY (no expected identity set); self-signing from dev creds')
		token = null
	}
	const result = await startManagedDaemon({
		token,
		apiOrigin,
		syncOrigin,
		stage: Schema.decodeUnknownSync(DaemonStage)(process.env.RIPTIDE_DAEMON_CHANNEL ?? 'local'),
		generationId: process.env.RIPTIDE_DAEMON_GENERATION_ID ?? null,
		expectedIdentity,
	})
	if (result.type === 'automation_complete') {
		throw new Error('Standalone daemon startup returned an unexpected automation result')
	}
	console.log(encodeDaemonProcessEvent(result))
	if (result.type === 'daemon_already_running') process.exit(0)
}

// Start the daemon
main().catch(async (error) => {
	// Also write to stderr synchronously: the file logger may not flush before
	// process.exit, so early startup failures would otherwise crash with zero
	// output anywhere, making them very hard to diagnose.
	console.error('Failed to start daemon:', error)
	logger.error(error, 'Failed to start daemon')
	Sentry.captureException(error)
	await Sentry.flush(2000).catch(() => {})
	process.exit(1)
})
