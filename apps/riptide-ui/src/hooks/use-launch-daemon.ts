import type { DaemonLaunchResult } from '@humanlayer/riptide-electron-rpc'
import { useCallback, useRef, useState } from 'react'

import { useIsHostOnline } from '@/hooks/live-queries/use-is-host-online'
import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { whenLocalDaemonPolicySettled } from '@/hooks/stores/localDaemonPolicyStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useUserInfo } from '@/hooks/useUserInfo'
import { isDaemonRunning, shouldStartManagedDaemon, startDaemon, stopDaemon } from '@/integrations/desktop/daemon'
import { getHostId } from '@/integrations/desktop/host'

export type LaunchDaemonStatus = 'idle' | 'starting' | 'waiting-for-host' | 'success' | 'error'

export interface LaunchDaemonState {
	status: LaunchDaemonStatus
	outputLines: string[]
	targetHostId: string | null
	errorMessage: string | null
	hostWaitExpired: boolean
}

interface ExecuteLaunchDaemonArgs {
	tokenFactory: (hostId: string) => Promise<{ token: string }>
	userId: string | null
	organizationId: string | null
	syncMode: 'auto' | 'electric' | 'query'
	verifiedClaudePath: string | null
	appendLine: (line: string) => void
	dependencies?: LaunchDaemonDependencies
}

interface LaunchDaemonDependencies {
	getHostId: () => Promise<string | null>
	isDaemonRunning: (userId: string, organizationId: string) => Promise<boolean>
	stopDaemon: (userId: string, organizationId: string) => Promise<boolean>
	startDaemon: (
		token: string,
		userId: string,
		organizationId: string,
		syncMode: 'auto' | 'electric' | 'query',
		verifiedClaudePath: string | null,
	) => Promise<DaemonLaunchResult | null>
	/** Reads the saved local daemon setting at call time. Defaults to the settings store. */
	isLocalDaemonEnabled?: () => boolean
	/** Waits for pending local daemon setting changes to reach the desktop app. */
	whenPolicySettled?: () => Promise<void>
}

export interface UseLaunchDaemonOptions {
	syncMode: 'auto' | 'electric' | 'query'
	tokenFactory: (hostId: string) => Promise<{ token: string }>
	userId: string | null
	organizationId: string | null
	dependencies?: LaunchDaemonDependencies
}

const DEFAULT_DEPENDENCIES: LaunchDaemonDependencies = {
	getHostId,
	isDaemonRunning,
	stopDaemon,
	startDaemon,
}

const HOST_ONLINE_SUCCESS_LINE = 'Host reported online. Daemon launch complete.'
const HOST_ONLINE_TIMEOUT_SECONDS = 60
const HOST_ONLINE_TIMEOUT_LINE = `Host did not report online within ${HOST_ONLINE_TIMEOUT_SECONDS} seconds.`
const HOST_ONLINE_TIMEOUT_MESSAGE = `Could not start the daemon. This host did not come online within ${HOST_ONLINE_TIMEOUT_SECONDS} seconds. Relaunch the daemon to try again.`
const LOCAL_DAEMON_DISABLED_MESSAGE =
	'Could not start the daemon. The local daemon is turned off. Turn it on in Settings -> Hosts -> Advanced.'
const STOP_UNRESPONSIVE_DAEMON_MESSAGE =
	'Could not stop the unresponsive daemon. Quit and reopen HumanLayer to restart it.'

export function createInitialLaunchDaemonState(): LaunchDaemonState {
	return {
		status: 'idle',
		outputLines: [],
		targetHostId: null,
		errorMessage: null,
		hostWaitExpired: false,
	}
}

export function applyHostOnlineSignal(state: LaunchDaemonState, isHostOnline: boolean): LaunchDaemonState {
	if (!isHostOnline || state.status !== 'waiting-for-host') {
		return state
	}

	return {
		...state,
		status: 'success',
		errorMessage: null,
		outputLines: [...state.outputLines, HOST_ONLINE_SUCCESS_LINE],
	}
}

export function expireHostWait(state: LaunchDaemonState): LaunchDaemonState {
	if (state.status !== 'waiting-for-host') {
		return state
	}

	return { ...state, hostWaitExpired: true }
}

export function applyHostWaitTimeout(state: LaunchDaemonState): LaunchDaemonState {
	if (state.status !== 'waiting-for-host' || !state.hostWaitExpired) {
		return state
	}

	return {
		...state,
		status: 'error',
		errorMessage: HOST_ONLINE_TIMEOUT_MESSAGE,
		outputLines: [...state.outputLines, HOST_ONLINE_TIMEOUT_LINE],
	}
}

export async function executeLaunchDaemon({
	tokenFactory,
	userId,
	organizationId,
	syncMode,
	verifiedClaudePath,
	appendLine,
	dependencies = DEFAULT_DEPENDENCIES,
}: ExecuteLaunchDaemonArgs): Promise<{ targetHostId: string }> {
	if (!userId) {
		throw new Error('Unable to launch daemon: missing user ID.')
	}

	if (!organizationId) {
		throw new Error('Unable to launch daemon: missing organization ID.')
	}

	const isLocalDaemonEnabled =
		dependencies.isLocalDaemonEnabled ?? (() => useSettingsStore.getState().localDaemonEnabled)
	if (!isLocalDaemonEnabled()) {
		throw new Error(LOCAL_DAEMON_DISABLED_MESSAGE)
	}

	appendLine('Resolving local host identity...')
	const hostId = await dependencies.getHostId()
	if (!hostId) {
		throw new Error('Unable to resolve local host ID')
	}

	appendLine('Requesting daemon token...')
	const { token } = await tokenFactory(hostId)
	if (!token) {
		throw new Error('Daemon token request returned no token')
	}

	if (await dependencies.isDaemonRunning(userId, organizationId)) {
		appendLine('Stopping unresponsive daemon...')
		const stopped = await dependencies.stopDaemon(userId, organizationId)
		if (!stopped) {
			throw new Error(STOP_UNRESPONSIVE_DAEMON_MESSAGE)
		}
	}

	await (dependencies.whenPolicySettled ?? whenLocalDaemonPolicySettled)()
	// The setting can change while the token request is in flight.
	if (!isLocalDaemonEnabled()) {
		throw new Error(LOCAL_DAEMON_DISABLED_MESSAGE)
	}

	appendLine('Starting daemon process...')
	const launchResult = await dependencies.startDaemon(token, userId, organizationId, syncMode, verifiedClaudePath)
	if (launchResult === null) {
		throw new Error('Daemon launch returned no result')
	}

	return { targetHostId: hostId }
}

export function useLaunchDaemon(options: UseLaunchDaemonOptions) {
	const [state, setState] = useState<LaunchDaemonState>(() => createInitialLaunchDaemonState())
	const verifiedClaudePath = useAgentConnectionsStore(
		(store) =>
			store.agentConnections.find((connection) => connection.agent === 'claude' && connection.status === 'ready')
				?.path ?? null,
	)
	const { dbOrganizationId } = useUserInfo()
	const { isOnline: isTargetHostOnline } = useIsHostOnline(
		state.targetHostId && dbOrganizationId && options.userId
			? {
					hostId: state.targetHostId,
					organizationId: dbOrganizationId,
					userId: options.userId,
				}
			: undefined,
	)
	const stateWithOnlineSignal = applyHostWaitTimeout(applyHostOnlineSignal(state, isTargetHostOnline))

	const isRunning = stateWithOnlineSignal.status === 'starting' || stateWithOnlineSignal.status === 'waiting-for-host'
	const localDaemonEnabled = useSettingsStore((store) => store.localDaemonEnabled)
	const canLaunch =
		Boolean(options.userId && options.organizationId && localDaemonEnabled && shouldStartManagedDaemon()) &&
		!isRunning

	const appendLine = useCallback((line: string) => {
		setState((prev) => ({
			...prev,
			outputLines: [...prev.outputLines, line],
		}))
	}, [])

	const hostWaitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

	const reset = useCallback(() => {
		clearTimeout(hostWaitTimer.current)
		setState(createInitialLaunchDaemonState())
	}, [])

	const launch = useCallback(async () => {
		if (!canLaunch) {
			return
		}

		clearTimeout(hostWaitTimer.current)
		setState((prev) => ({
			...prev,
			status: 'starting',
			outputLines: [],
			targetHostId: null,
			errorMessage: null,
			hostWaitExpired: false,
		}))

		try {
			const { targetHostId } = await executeLaunchDaemon({
				tokenFactory: options.tokenFactory,
				userId: options.userId,
				organizationId: options.organizationId,
				syncMode: options.syncMode,
				verifiedClaudePath,
				appendLine,
				dependencies: options.dependencies,
			})

			setState((prev) => ({
				...prev,
				status: 'waiting-for-host',
				targetHostId,
				errorMessage: null,
			}))

			const shortHostId = targetHostId.slice(0, 8)
			appendLine(`Waiting for host ${shortHostId} to appear online...`)
			hostWaitTimer.current = setTimeout(() => setState(expireHostWait), HOST_ONLINE_TIMEOUT_SECONDS * 1_000)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			setState((prev) => ({
				...prev,
				status: 'error',
				errorMessage: message,
			}))
			appendLine(`Launch failed: ${message}`)
		}
	}, [
		canLaunch,
		options.tokenFactory,
		options.userId,
		options.organizationId,
		options.syncMode,
		options.dependencies,
		verifiedClaudePath,
		appendLine,
	])

	return {
		state: stateWithOnlineSignal,
		launch,
		reset,
		canLaunch,
		isRunning,
	}
}
