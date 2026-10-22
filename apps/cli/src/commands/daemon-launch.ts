import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { ORPCError } from '@orpc/client'

import { resolveWorkOSToken } from '../auth'
import { getHostId } from '../lib/host-id'
import type { EnvironmentConfig, EnvironmentName } from '../lib/macros'
import { createApiORPCClient, createUnauthenticatedApiORPCClient } from '../orpc/client'
import {
	isSelfUpdateDisabled,
	resolveSelfUpdateCapability,
	type DaemonCredentialSource,
} from './self-update-capability'

const execFileAsync = promisify(execFile)

interface DaemonLaunchOptions {
	token?: string
	launchToken?: string
	selfUpdate?: boolean
}

export function loginCommandForEnvironment(envName: EnvironmentName): string {
	return envName === 'prod' ? 'humanlayer login' : `humanlayer --${envName} login`
}

export function environmentFlagForEnvironment(envName: EnvironmentName): string | null {
	return envName === 'prod' ? null : `--${envName}`
}

async function resolveNpmGlobalPrefix(): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('npm', ['prefix', '-g'], { timeout: 10_000 })
		const prefix = stdout.trim()
		return prefix.length > 0 ? prefix : null
	} catch {
		return null
	}
}

export function formatDaemonLaunchError(error: unknown, envName: EnvironmentName): string {
	if (error instanceof ORPCError && error.code === 'ORGANIZATION_REQUIRED') {
		return `Could not launch daemon because the CLI is not signed in to an organization.\nRun \`${loginCommandForEnvironment(envName)}\`, then try again.`
	}

	return `Failed to launch daemon: ${error instanceof Error ? error.message : String(error)}`
}

export async function daemonLaunchCommand(
	envName: EnvironmentName,
	envConfig: EnvironmentConfig,
	options: DaemonLaunchOptions,
): Promise<void> {
	try {
		// Resolve the daemon token
		let daemonToken: string
		let credentialSource: DaemonCredentialSource

		const explicitToken = options.token ?? process.env.RIPTIDE_DAEMON_TOKEN
		if (explicitToken) {
			// Direct token passthrough — skip all auth
			daemonToken = explicitToken
			credentialSource = 'explicit-token'
			console.log('Using provided daemon token.')
		} else if (options.launchToken) {
			// Launch token → exchange for daemon token
			const hostId = await getHostId()
			console.log('Exchanging launch token for daemon credentials...')
			const unauthClient = createUnauthenticatedApiORPCClient(envConfig.apiOrigin)
			const { token } = await unauthClient.auth.daemon.token.exchange({
				launchToken: options.launchToken,
				hostId,
			})
			daemonToken = token
			credentialSource = 'launch-token'
			console.log('Daemon token obtained via launch token exchange.')
		} else {
			// WorkOS auth → daemon token exchange
			const session = await resolveWorkOSToken(envName, envConfig)

			// Get host_id (reads/creates ~/.humanlayer/riptide/host_id)
			const hostId = await getHostId()

			// Exchange WorkOS token for daemon token
			console.log('Exchanging token for daemon credentials...')
			const apiClient = createApiORPCClient(envConfig.apiOrigin, session.access_token)
			const { token } = await apiClient.auth.daemon.token.create({ hostId })
			daemonToken = token
			credentialSource = 'stored-session'
			console.log('Daemon token obtained.')
		}

		// Import and start the daemon in-process
		// When launched via CLI, always log to stdout so operators can see daemon output.
		// The daemon logger only adds a stdout transport when LOG_LEVEL is set.
		if (!process.env.LOG_LEVEL) {
			process.env.LOG_LEVEL = 'info'
		}
		// The CLI supports several environments from one binary. Set the selected origins before
		// loading the embedded daemon: artifact hooks link through the cloud origin, and commit
		// attribution mints session deep links from the app origin.
		process.env.RIPTIDE_CLOUD_ORIGIN = envConfig.cloudOrigin
		process.env.RIPTIDE_APP_ORIGIN = envConfig.appOrigin
		const selfUpdateDisabled = isSelfUpdateDisabled(options.selfUpdate === false, process.env)
		if (selfUpdateDisabled) {
			console.log('Self-update is off. Update this daemon by replacing the CLI on the host.')
		}
		const selfUpdate = resolveSelfUpdateCapability({
			platform: process.platform,
			execPath: process.execPath,
			env: process.env,
			credentialSource,
			environmentFlag: environmentFlagForEnvironment(envName),
			npmGlobalPrefix: selfUpdateDisabled ? null : await resolveNpmGlobalPrefix(),
			disabled: selfUpdateDisabled,
		})

		console.log('Starting daemon...')
		const { startManagedDaemon } = await import('@humanlayer/riptide-daemon/start')
		const result = await startManagedDaemon({
			token: daemonToken,
			apiOrigin: envConfig.apiOrigin,
			syncOrigin: envConfig.syncOrigin,
			stage: envName,
			generationId: null,
			expectedIdentity: null,
			selfUpdate,
		})

		if (result.type === 'automation_complete') {
			throw new Error('Daemon launch returned an unexpected automation result')
		}
		if (result.type === 'daemon_already_running') {
			console.log(result.message)
		}
	} catch (error) {
		console.error(formatDaemonLaunchError(error, envName))
		process.exit(1)
	}
}
