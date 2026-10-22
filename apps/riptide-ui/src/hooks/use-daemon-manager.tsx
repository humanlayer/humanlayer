import { ORPCError } from '@orpc/client'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@workos-inc/authkit-react'
import { Match } from 'effect'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { CodeLayerToastButtons } from '@/components/CodeLayerToastButtons'
import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { applySavedLocalDaemonPolicy, whenLocalDaemonPolicySettled } from '@/hooks/stores/localDaemonPolicyStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useMountEffect } from '@/hooks/useMountEffect'
import { onDaemonLifecycleEvent, shouldStartManagedDaemon, startDaemon } from '@/integrations/desktop/daemon'
import { getHostId } from '@/integrations/desktop/host'
import { logger } from '@/lib/logger'
import { isDesktop } from '@/lib/utils'
import { useRiptideApi } from '@/orpc/client'

export const DAEMON_LAUNCH_FAILED_TOAST_ID = 'daemon-launch-failed'

const NATIVE_LAUNCH_CANCELLED_PREFIX = 'Daemon launch cancelled'
const NATIVE_AUTH_FAILURE_PREFIX = 'Daemon authentication failed: '

function isHandledElsewhere(error: unknown): boolean {
	if (error instanceof ORPCError) return error.code === 'UNAUTHORIZED'
	const message = error instanceof Error ? error.message : String(error)
	return message.startsWith(NATIVE_LAUNCH_CANCELLED_PREFIX) || message.startsWith(NATIVE_AUTH_FAILURE_PREFIX)
}

function retryDaemonLaunch() {
	toast.dismiss(DAEMON_LAUNCH_FAILED_TOAST_ID)
	useLocalDaemonLaunchStore.getState().retryLaunch()
}

function showDaemonLaunchFailedToast() {
	toast.error('Could not start the daemon on this device', {
		id: DAEMON_LAUNCH_FAILED_TOAST_ID,
		duration: Infinity,
		description: 'Tasks on this device wait until the daemon starts.',
		action: (
			<CodeLayerToastButtons
				action={{ label: 'Retry', onClick: () => retryDaemonLaunch() }}
				variant="error"
				toastId={DAEMON_LAUNCH_FAILED_TOAST_ID}
			/>
		),
	})
}

/**
 * Hook that manages daemon lifecycle within the auth context.
 * Automatically starts daemon when user is authenticated, org is selected, and the local daemon
 * setting is on. Reapplies that setting to the desktop app on mount so a reload cannot restart
 * daemons the user turned off.
 * Listens for daemon-died events and shows toasts.
 *
 * Note: The Rust side (DaemonManager) is the source of truth for running daemons.
 * It handles idempotency - if a daemon is already running for a user+org, it returns
 * the existing daemon info instead of starting a new one.
 */
export function useDaemonManager() {
	const { user, organizationId, isLoading: isAuthLoading } = useAuth()
	const { client: api } = useRiptideApi()
	const navigate = useNavigate()
	const syncForceMode = useSettingsStore((state) => state.syncForceMode)
	const verifiedClaudePath = useAgentConnectionsStore((state) => state.lastVerifiedClaudePath)
	const launchAttempt = useLocalDaemonLaunchStore((state) => state.launchAttempt)
	const localDaemonEnabled = useSettingsStore((state) => state.localDaemonEnabled)

	// Runs before the startup effect below, so startup waits for the saved setting to apply.
	useMountEffect(() => {
		if (isDesktop()) void applySavedLocalDaemonPolicy()
	})

	// Listen for daemon-died events
	useEffect(() => {
		if (!isDesktop()) return

		let unlisten: (() => void) | null = null

		void onDaemonLifecycleEvent((event) => {
			logger.warn('Daemon died unexpectedly', event)

			Match.value(event).pipe(
				Match.tag('AuthenticationFailed', (event) => {
					const toastId = `daemon-auth-failure-${Date.now()}`
					toast.error('Daemon error', {
						id: toastId,
						duration: 8000,
						description: event.message,
						action: (
							<CodeLayerToastButtons
								action={{
									label: 'Sign in',
									onClick: () => {
										toast.dismiss(toastId)
										navigate({ to: '/auth/signin' })
									},
								}}
								variant="error"
								toastId={toastId}
							/>
						),
					})
				}),
				Match.tag('UnexpectedExit', () => {
					toast.warning('Coding agent stopped unexpectedly', {
						description: 'Attempting to restart...',
					})
				}),
				Match.tag('RestartFailed', () => {
					toast.error('Coding agent stopped unexpectedly', {
						description: 'Automatic restart failed. Please restart the app.',
					})
				}),
				Match.orElse(() => undefined),
			)
		}).then((fn) => {
			unlisten = fn
		})

		return () => {
			unlisten?.()
		}
	}, [navigate])

	// Start daemon when auth conditions are met
	// The Rust side handles idempotency - it won't start a new daemon if one is already running
	useEffect(() => {
		if (!shouldStartManagedDaemon()) return
		if (!localDaemonEnabled) return
		if (isAuthLoading) return
		if (!user?.id) return
		if (!organizationId) return

		const userId = user.id
		const orgId = organizationId

		let cancelled = false

		async function initializeDaemon() {
			const launch = useLocalDaemonLaunchStore.getState()
			toast.dismiss(DAEMON_LAUNCH_FAILED_TOAST_ID)
			launch.launchStarted()
			try {
				// Get host ID
				const hostId = await getHostId()
				if (cancelled) return
				if (!hostId) {
					launch.launchFailed()
					return
				}

				logger.info('Requesting daemon token', {
					userId,
					organizationId,
					hostId,
				})

				// Request daemon token via oRPC
				// The api object is recreated when organizationId changes, ensuring fresh tokens
				const { token } = await api.auth.daemon.token.create({ hostId })

				if (cancelled) return

				logger.info('Received daemon token, starting daemon', {
					syncMode: syncForceMode,
				})

				// A turn-on may still be reopening the desktop gate; a turn-off may have happened meanwhile.
				await whenLocalDaemonPolicySettled()
				if (cancelled || !useSettingsStore.getState().localDaemonEnabled) return

				// The desktop app returns existing daemon info if one is already running for this user+org
				const launchResult = await startDaemon(token, userId, orgId, syncForceMode, verifiedClaudePath)
				if (cancelled) return
				if (!launchResult) {
					launch.launchFailed()
					return
				}
				launch.launchSucceeded()
				logger.info('Daemon availability confirmed', {
					outcome: launchResult.type,
					userId,
					organizationId,
					syncMode: syncForceMode,
				})
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				logger.error('Failed to initialize daemon', { error: message })
				if (cancelled) return
				launch.launchFailed()
				if (!isHandledElsewhere(error)) showDaemonLaunchFailedToast()
			}
		}

		void initializeDaemon()

		return () => {
			cancelled = true
			toast.dismiss(DAEMON_LAUNCH_FAILED_TOAST_ID)
		}
	}, [
		user?.id,
		organizationId,
		isAuthLoading,
		api,
		syncForceMode,
		verifiedClaudePath,
		launchAttempt,
		localDaemonEnabled,
	])
}
