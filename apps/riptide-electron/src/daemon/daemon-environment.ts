import type { DaemonIdentity } from '@humanlayer/schemas/effect/daemon/identity'
import type { DaemonStage } from '@humanlayer/schemas/effect/daemon/stage'
import * as Effect from 'effect/Effect'
import * as Redacted from 'effect/Redacted'

import { loadInteractiveShellEnvironment } from '../diagnostics/child-process-output'
import { InheritedEnvironment } from '../platform/inherited-environment'

const forwardedEnvironmentNames = [
	'DEVSTACK_ID',
	'RIPTIDE_API_ORIGIN',
	'RIPTIDE_SYNC_ORIGIN',
	'RIPTIDE_DAEMON_API_ORIGIN',
	'RIPTIDE_DAEMON_SYNC_ORIGIN',
	'RIPTIDE_DAEMON_CLOUD_ORIGIN',
] as const

const pathDelimiter = process.platform === 'win32' ? ';' : ':'

export const mergeDaemonEnvironment = (
	electronEnvironment: Record<string, string>,
	shellEnvironment: Record<string, string>,
): Record<string, string> => {
	const environment = { ...electronEnvironment, ...shellEnvironment }
	const pathEntries = [shellEnvironment.PATH, electronEnvironment.PATH].flatMap((path) =>
		path === undefined ? [] : path.split(pathDelimiter).filter(Boolean),
	)
	if (pathEntries.length > 0) environment.PATH = [...new Set(pathEntries)].join(pathDelimiter)
	return environment
}

export const buildDaemonEnvironment = Effect.fn('daemon_supervisor.build_environment')(function* (input: {
	readonly token: Redacted.Redacted<string>
	readonly generationId: string
	readonly channel: DaemonStage
	readonly apiOrigin: string
	readonly syncOrigin: string
	readonly expectedIdentity: DaemonIdentity
	readonly verifiedClaudePath: string | null
}) {
	const inherited = yield* InheritedEnvironment
	const shellEnvironment = yield* loadInteractiveShellEnvironment().pipe(
		Effect.tapError((error) =>
			Effect.logWarning('Interactive shell environment unavailable; using Electron environment', error),
		),
		Effect.catchTag('CliProcessFailure', () => inherited.snapshot),
	)
	const environment = mergeDaemonEnvironment(yield* inherited.snapshot, shellEnvironment)
	const forwardedEnvironment = yield* inherited.snapshot
	for (const name of forwardedEnvironmentNames) {
		const value = forwardedEnvironment[name]
		if (value !== undefined) environment[name] = value
	}
	delete environment.DAEMON_IDENTITY
	delete environment.RIPTIDE_DAEMON_EXPECTED_IDENTITY
	// The renderer's origins win over any login-shell/forwarded value and over the
	// daemon's build-time baked origin. RIPTIDE_API_ORIGIN/RIPTIDE_SYNC_ORIGIN are
	// the only runtime origin levers the daemon honors.
	environment.RIPTIDE_API_ORIGIN = input.apiOrigin
	environment.RIPTIDE_SYNC_ORIGIN = input.syncOrigin
	if (input.verifiedClaudePath) environment.HUMANLAYER_CLAUDE_PATH = input.verifiedClaudePath
	environment.DAEMON_IDENTITY = Redacted.value(input.token)
	environment.RIPTIDE_DAEMON_EXPECTED_IDENTITY = JSON.stringify(input.expectedIdentity)
	environment.RIPTIDE_DAEMON_USE_ORPHAN_DETECTION = '1'
	environment.RIPTIDE_DAEMON_GENERATION_ID = input.generationId
	environment.RIPTIDE_DAEMON_CHANNEL = input.channel
	environment.NODE_USE_SYSTEM_CA = '1'
	environment.BUN_CONFIG_MAX_HTTP_REQUESTS = '1000'
	return environment
})
