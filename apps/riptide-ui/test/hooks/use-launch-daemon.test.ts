import { describe, expect, test, vi } from 'vitest'

import {
	applyHostOnlineSignal,
	applyHostWaitTimeout,
	createInitialLaunchDaemonState,
	executeLaunchDaemon,
	expireHostWait,
	type LaunchDaemonState,
} from '@/hooks/use-launch-daemon'

const noDaemonRunning = {
	isDaemonRunning: async () => false,
	stopDaemon: async () => true,
}

const waitingForHost: LaunchDaemonState = {
	status: 'waiting-for-host',
	outputLines: ['Waiting for host abc12345 to appear online...'],
	targetHostId: 'abc12345',
	errorMessage: null,
	hostWaitExpired: false,
}

describe('executeLaunchDaemon', () => {
	test('refuses to launch when the local daemon is turned off', async () => {
		const tokenFactory = vi.fn(async () => ({ token: 'token' }))
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))

		await expect(
			executeLaunchDaemon({
				tokenFactory,
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => 'host-1',
					startDaemon,
					...noDaemonRunning,
					isLocalDaemonEnabled: () => false,
				},
			}),
		).rejects.toThrow('The local daemon is turned off')
		expect(tokenFactory).not.toHaveBeenCalled()
		expect(startDaemon).not.toHaveBeenCalled()
	})

	test('does not start when the local daemon is turned off during the token request', async () => {
		let enabled = true
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))
		const whenPolicySettled = vi.fn(async () => {})

		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => {
					enabled = false
					return { token: 'token' }
				},
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => 'host-1',
					startDaemon,
					...noDaemonRunning,
					isLocalDaemonEnabled: () => enabled,
					whenPolicySettled,
				},
			}),
		).rejects.toThrow('The local daemon is turned off')
		expect(whenPolicySettled).toHaveBeenCalledTimes(1)
		expect(startDaemon).not.toHaveBeenCalled()
	})

	test('requests token and starts daemon with local host ID', async () => {
		const outputLines: string[] = []
		const getHostId = vi.fn(async () => 'local-host-123')
		const tokenFactory = vi.fn(async (hostId: string) => ({ token: `${hostId}-token` }))
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))

		const result = await executeLaunchDaemon({
			tokenFactory,
			userId: 'user-1',
			organizationId: 'org-1',
			syncMode: 'auto',
			verifiedClaudePath: '/Users/dev/.local/bin/claude',
			appendLine: (line) => outputLines.push(line),
			dependencies: { getHostId, startDaemon, ...noDaemonRunning },
		})

		expect(result.targetHostId).toBe('local-host-123')
		expect(getHostId).toHaveBeenCalledTimes(1)
		expect(tokenFactory).toHaveBeenCalledWith('local-host-123')
		expect(startDaemon).toHaveBeenCalledWith(
			'local-host-123-token',
			'user-1',
			'org-1',
			'auto',
			'/Users/dev/.local/bin/claude',
		)
		expect(outputLines).toEqual([
			'Resolving local host identity...',
			'Requesting daemon token...',
			'Starting daemon process...',
		])
	})

	test('uses the pre-resolved host ID after an already-running handoff', async () => {
		const outputLines: string[] = []
		const startDaemon = vi.fn(async () => ({
			type: 'daemon_already_running' as const,
			message: 'Matching daemon already owns the lease',
		}))

		const result = await executeLaunchDaemon({
			tokenFactory: async (hostId) => ({ token: `${hostId}-token` }),
			userId: 'user-1',
			organizationId: 'org-1',
			syncMode: 'auto',
			verifiedClaudePath: null,
			appendLine: (line) => outputLines.push(line),
			dependencies: {
				getHostId: async () => 'known-host-123',
				startDaemon,
				...noDaemonRunning,
			},
		})

		expect(result.targetHostId).toBe('known-host-123')
		expect(startDaemon).toHaveBeenCalledWith('known-host-123-token', 'user-1', 'org-1', 'auto', null)
	})

	test('throws when user id is missing', async () => {
		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: 'token' }),
				userId: null,
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
			}),
		).rejects.toThrow('Unable to launch daemon: missing user ID.')
	})

	test('throws when organization id is missing', async () => {
		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: 'token' }),
				userId: 'user-1',
				organizationId: null,
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
			}),
		).rejects.toThrow('Unable to launch daemon: missing organization ID.')
	})

	test('throws when token factory returns empty token', async () => {
		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: '' }),
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => 'host-1',
					startDaemon: async () => null,
					...noDaemonRunning,
				},
			}),
		).rejects.toThrow('Daemon token request returned no token')
	})

	test('allows retry after a failed launch attempt', async () => {
		const outputLines: string[] = []
		const tokenFactory = vi.fn(async () => ({ token: 'retry-token' }))
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))

		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => {
					throw new Error('Token service unavailable')
				},
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: (line) => outputLines.push(line),
				dependencies: {
					getHostId: async () => 'host-1',
					startDaemon,
					...noDaemonRunning,
				},
			}),
		).rejects.toThrow('Token service unavailable')

		const retry = await executeLaunchDaemon({
			tokenFactory,
			userId: 'user-1',
			organizationId: 'org-1',
			syncMode: 'auto',
			verifiedClaudePath: null,
			appendLine: (line) => outputLines.push(line),
			dependencies: {
				getHostId: async () => 'host-1',
				startDaemon,
				...noDaemonRunning,
			},
		})

		expect(retry.targetHostId).toBe('host-1')
		expect(tokenFactory).toHaveBeenCalledTimes(1)
		expect(startDaemon).toHaveBeenCalledTimes(1)
		expect(outputLines).toEqual([
			'Resolving local host identity...',
			'Requesting daemon token...',
			'Resolving local host identity...',
			'Requesting daemon token...',
			'Starting daemon process...',
		])
	})

	test('throws when host id cannot be resolved', async () => {
		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: 'token' }),
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => null,
					startDaemon: async () => null,
					...noDaemonRunning,
				},
			}),
		).rejects.toThrow('Unable to resolve local host ID')
	})

	test('stops a running daemon before starting a fresh one', async () => {
		const outputLines: string[] = []
		const calls: string[] = []
		const isDaemonRunning = vi.fn(async () => true)
		const stopDaemon = vi.fn(async () => {
			calls.push('stop')
			return true
		})
		const startDaemon = vi.fn(async () => {
			calls.push('start')
			return { type: 'daemon_ready' as const }
		})

		await executeLaunchDaemon({
			tokenFactory: async () => ({ token: 'token' }),
			userId: 'user-1',
			organizationId: 'org-1',
			syncMode: 'auto',
			verifiedClaudePath: null,
			appendLine: (line) => outputLines.push(line),
			dependencies: { getHostId: async () => 'host-1', isDaemonRunning, stopDaemon, startDaemon },
		})

		expect(isDaemonRunning).toHaveBeenCalledWith('user-1', 'org-1')
		expect(stopDaemon).toHaveBeenCalledWith('user-1', 'org-1')
		expect(calls).toEqual(['stop', 'start'])
		expect(outputLines).toEqual([
			'Resolving local host identity...',
			'Requesting daemon token...',
			'Stopping unresponsive daemon...',
			'Starting daemon process...',
		])
	})

	test('does not stop anything when no daemon is running', async () => {
		const stopDaemon = vi.fn(async () => true)
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))

		await executeLaunchDaemon({
			tokenFactory: async () => ({ token: 'token' }),
			userId: 'user-1',
			organizationId: 'org-1',
			syncMode: 'auto',
			verifiedClaudePath: null,
			appendLine: () => {},
			dependencies: {
				getHostId: async () => 'host-1',
				isDaemonRunning: async () => false,
				stopDaemon,
				startDaemon,
			},
		})

		expect(stopDaemon).not.toHaveBeenCalled()
		expect(startDaemon).toHaveBeenCalledTimes(1)
	})

	test('does not start a daemon when the running one cannot be stopped', async () => {
		const startDaemon = vi.fn(async () => ({ type: 'daemon_ready' as const }))

		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: 'token' }),
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => 'host-1',
					isDaemonRunning: async () => true,
					stopDaemon: async () => false,
					startDaemon,
				},
			}),
		).rejects.toThrow('Could not stop the unresponsive daemon.')
		expect(startDaemon).not.toHaveBeenCalled()
	})

	test('throws when startDaemon does not return a launch result', async () => {
		await expect(
			executeLaunchDaemon({
				tokenFactory: async () => ({ token: 'token' }),
				userId: 'user-1',
				organizationId: 'org-1',
				syncMode: 'auto',
				verifiedClaudePath: null,
				appendLine: () => {},
				dependencies: {
					getHostId: async () => 'host-1',
					startDaemon: async () => null,
					...noDaemonRunning,
				},
			}),
		).rejects.toThrow('Daemon launch returned no result')
	})
})

describe('applyHostOnlineSignal', () => {
	test('transitions waiting-for-host to success when host is online', () => {
		const next = applyHostOnlineSignal(waitingForHost, true)

		expect(next.status).toBe('success')
		expect(next.errorMessage).toBeNull()
		expect(next.outputLines.at(-1)).toBe('Host reported online. Daemon launch complete.')
	})

	test('leaves non-waiting states unchanged', () => {
		const initial = createInitialLaunchDaemonState()
		const next = applyHostOnlineSignal(initial, true)
		expect(next).toEqual(initial)
	})
})

describe('applyHostWaitTimeout', () => {
	test('moves waiting-for-host to error once the wait expires', () => {
		const next = applyHostWaitTimeout(expireHostWait(waitingForHost))

		expect(next.status).toBe('error')
		expect(next.errorMessage).toBe(
			'Could not start the daemon. This host did not come online within 60 seconds. Relaunch the daemon to try again.',
		)
		expect(next.outputLines.at(-1)).toBe('Host did not report online within 60 seconds.')
	})

	test('keeps waiting before the wait expires', () => {
		expect(applyHostWaitTimeout(waitingForHost)).toEqual(waitingForHost)
	})

	test('reports success when the host comes online after the wait expires', () => {
		const next = applyHostWaitTimeout(applyHostOnlineSignal(expireHostWait(waitingForHost), true))

		expect(next.status).toBe('success')
		expect(next.errorMessage).toBeNull()
	})

	test('ignores an expired wait once the launch has left waiting-for-host', () => {
		const initial = createInitialLaunchDaemonState()
		expect(expireHostWait(initial)).toEqual(initial)
	})
})
