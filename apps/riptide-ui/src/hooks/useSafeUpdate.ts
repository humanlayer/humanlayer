import { useMutation } from '@tanstack/react-query'
import { useAuth } from '@workos-inc/authkit-react'

import { type SyncContextValue, useSync } from '@/components/providers/SyncProvider'
import { useUpgradeAffectedSessionCount } from '@/hooks/live-queries/useUpgradeAffectedSessionCount'
import { useIsColocated } from '@/hooks/use-colocated'
import { useUpdate } from '@/hooks/use-update'
import { useSessionActions } from '@/hooks/useSessionActions'
import { captureException } from '@/integrations/sentry/sentry'
import { logger } from '@/lib/logger'

const INTERRUPT_SETTLEMENT_TIMEOUT_MS = 10_000

export class SessionShutdownError extends Error {
	constructor(cause: unknown) {
		super('Failed to interrupt active sessions', { cause })
		this.name = 'SessionShutdownError'
	}
}

function waitForInterruptSettlement(
	sessionsCollection: SyncContextValue['sessionsCollection'],
	sessionIds: string[],
): Promise<void> {
	const haveSessionsSettled = () =>
		sessionIds.every((sessionId) => sessionsCollection.state.get(sessionId)?.status !== 'interrupt_requested')

	if (haveSessionsSettled()) return Promise.resolve()

	return new Promise((resolve) => {
		let finished = false
		let unsubscribe: (() => void) | undefined
		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(timeoutId)
			unsubscribe?.()
			resolve()
		}
		const timeoutId = setTimeout(finish, INTERRUPT_SETTLEMENT_TIMEOUT_MS)
		const subscription = sessionsCollection.subscribeChanges(
			() => {
				if (haveSessionsSettled()) finish()
			},
			{ includeInitialState: false },
		)
		unsubscribe = () => subscription.unsubscribe()

		if (finished) unsubscribe()
		else if (haveSessionsSettled()) finish()
	})
}

/**
 * Installing an app update: interrupt this device's active sessions, wait for them to stop, then
 * install. `force` skips the interrupts after they failed. `onShutdownError` lets the caller tell
 * the user when sessions could not be stopped.
 */
export function useSafeUpdate({ onShutdownError }: { onShutdownError?: () => void } = {}) {
	const { update, isDownloading, startUpdate } = useUpdate()
	const { user } = useAuth()
	const { localHostId } = useIsColocated(undefined)
	const { sessionsCollection } = useSync()
	const { interruptSession } = useSessionActions()
	const { affectedSessionCount, affectedSessionIds, isLoading, isReady, isError } = useUpgradeAffectedSessionCount({
		userId: user?.id,
		localHostId,
		enabled: Boolean(update),
	})
	const safeUpdateMutation = useMutation({
		mutationKey: ['safe-update-install'],
		mutationFn: async (sessionIds: string[]) => {
			if (sessionIds.length > 0) {
				const persistencePromises = sessionIds.map((sessionId) => {
					try {
						return interruptSession({ sessionId }).isPersisted.promise
					} catch (error) {
						return Promise.reject(error)
					}
				})
				const results = await Promise.allSettled(persistencePromises)
				const failedResult = results.find((result) => result.status === 'rejected')
				if (failedResult?.status === 'rejected') throw new SessionShutdownError(failedResult.reason)

				await waitForInterruptSettlement(sessionsCollection, sessionIds)
			}

			await startUpdate()
		},
		onError: (error, sessionIds) => {
			if (!(error instanceof SessionShutdownError)) return

			const cause = error.cause
			const errorToReport = cause instanceof Error ? cause : new Error(String(cause))
			onShutdownError?.()
			logger.error({ error: cause, sessionIds }, 'Failed to interrupt active sessions before update')
			captureException(errorToReport, {
				tags: { error_type: 'upgrade_session_interruption_failed' },
				extra: { action: 'interruptSessionsForUpdate', affectedCount: sessionIds.length },
			})
		},
	})
	const forceUpdateMutation = useMutation({
		mutationKey: ['force-update-install'],
		mutationFn: startUpdate,
	})
	const shutdownError = safeUpdateMutation.error instanceof SessionShutdownError
	const isInterruptingSessions = safeUpdateMutation.isPending && !isDownloading && affectedSessionIds.length > 0
	const closeDisabled = isDownloading || safeUpdateMutation.isPending || forceUpdateMutation.isPending
	const confirmDisabled = closeDisabled || !isReady || isError

	return {
		affectedSessionCount,
		isLoading,
		isReady,
		isError,
		shutdownError,
		/** The install itself failed, not the interrupts before it. */
		installError: (!shutdownError && safeUpdateMutation.isError) || forceUpdateMutation.isError,
		isInterruptingSessions,
		closeDisabled,
		confirmDisabled,
		confirm: () => {
			if (confirmDisabled) return
			safeUpdateMutation.mutate([...affectedSessionIds])
		},
		force: () => {
			if (!shutdownError || closeDisabled) return
			forceUpdateMutation.mutate()
		},
	}
}
