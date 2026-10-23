import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'

import { CodeLayerToastButtons } from '@/components/CodeLayerToastButtons'
import { DismissableToastTitle } from '@/components/DismissableToastTitle'
import { type OutdatedHost, useOutdatedHosts } from '@/hooks/live-queries/use-outdated-hosts'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useRequestHostUpdate } from '@/hooks/use-request-host-update'
import { useMountEffect } from '@/hooks/useMountEffect'
import { buildConfig } from '@/lib/config'
import { formatRunningSessions } from '@/lib/host-stats'

function describeOutdatedHosts(count: number, runningSessionCount: number): string {
	const outdated =
		count === 1
			? '1 daemon runs an older version than this app'
			: `${count} daemons run an older version than this app`
	if (runningSessionCount === 0) return outdated
	return `${outdated}. Updating stops ${formatRunningSessions(runningSessionCount)}.`
}

function DaemonUpdateNotice({
	appVersion,
	outdatedHosts,
	targetDaemonVersion,
}: {
	appVersion: string
	outdatedHosts: OutdatedHost[]
	targetDaemonVersion: string | null
}) {
	const navigate = useNavigate()
	const setLastNoticedAppVersion = useSettingsStore((s) => s.setLastNoticedAppVersion)
	const requestHostUpdate = useRequestHostUpdate()

	useMountEffect(() => {
		if (outdatedHosts.length === 0) return
		setLastNoticedAppVersion(appVersion)

		const toastId = `daemons-out-of-date-${appVersion}`
		const updatableHosts = targetDaemonVersion ? outdatedHosts.filter((host) => host.isUpdatable) : []
		const runningSessionCount = updatableHosts.reduce((total, host) => total + host.runningSessionCount, 0)
		const canUpdateAllWithoutConfirming =
			updatableHosts.length > 0 &&
			runningSessionCount === 0 &&
			!updatableHosts.some((host) => host.hasOldSelfUpdater)

		const openDaemonSettings = () => {
			toast.dismiss(toastId)
			void navigate({ to: '/settings/daemons' })
		}

		const updateAll = () => {
			toast.dismiss(toastId)
			if (!targetDaemonVersion) return
			for (const host of updatableHosts) {
				requestHostUpdate.mutate({ hostId: host.hostId, version: targetDaemonVersion })
			}
			toast.success('Update requested')
		}

		toast(
			<DismissableToastTitle
				title="Daemons out of date"
				titleClassName="font-bold text-[var(--terminal-warning)]"
				description={describeOutdatedHosts(outdatedHosts.length, runningSessionCount)}
				onDismiss={() => toast.dismiss(toastId)}
			/>,
			{
				id: toastId,
				duration: 8000,
				action: canUpdateAllWithoutConfirming ? (
					<CodeLayerToastButtons
						action={{ label: 'Update all', onClick: updateAll }}
						cancel={{ label: 'View', onClick: openDaemonSettings }}
						variant="warning"
						toastId={toastId}
					/>
				) : (
					<CodeLayerToastButtons
						action={{ label: 'View', onClick: openDaemonSettings }}
						variant="warning"
						toastId={toastId}
					/>
				),
			},
		)
	})

	return null
}

export function DaemonUpdateNoticeHandler() {
	const lastNoticedAppVersion = useSettingsStore((s) => s.lastNoticedAppVersion)
	const { outdatedHosts, targetDaemonVersion, isReady } = useOutdatedHosts()

	if (lastNoticedAppVersion === buildConfig.version) return null
	if (!isReady) return null
	if (outdatedHosts.length === 0) return null

	return (
		<DaemonUpdateNotice
			key={buildConfig.version}
			appVersion={buildConfig.version}
			outdatedHosts={outdatedHosts}
			targetDaemonVersion={targetDaemonVersion}
		/>
	)
}
