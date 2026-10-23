import { useAuth } from '@workos-inc/authkit-react'
import { useState } from 'react'

import { useHostUsageLimits } from '@/hooks/live-queries/use-host-usage-limits'
import { useSessionHostState } from '@/hooks/live-queries/use-session-host-state'
import { useSettingsStore } from '@/hooks/stores/settingsStore'
import { useLaunchDaemon } from '@/hooks/use-launch-daemon'
import { getSessionHostRegistrationIdentity } from '@/lib/session-host-identity'
import { deriveSessionHostView } from '@/lib/session-host-state'
import type { SessionStatusHost } from '@/lib/session-status-label'
import { useRiptideApi } from '@/orpc/client'

import type { SessionDetailSession } from './useSessionDetailData'

/**
 * Host status for the session detail page: online/colocated detection, the
 * launch-local-daemon flow (with its modal open state), and the resolved
 * host display name.
 */
export function useSessionHostStatus(session: SessionDetailSession | undefined) {
	const { user, organizationId } = useAuth()
	const { client } = useRiptideApi()
	const syncForceMode = useSettingsStore((s) => s.syncForceMode)

	const usageLimits = useHostUsageLimits(getSessionHostRegistrationIdentity(session), session?.coding_agent)
	const { state: hostState, isLocal: isColocated, hostLabel, shortHostId } = useSessionHostState(session)
	const { isHostOffline, isHostStarting, isHostUpdating, canLaunchLocalDaemon } = deriveSessionHostView(
		hostState,
		isColocated,
	)
	const statusHost: SessionStatusHost | null =
		hostState && hostLabel ? { state: hostState, hostLabel, isLocal: isColocated } : null
	const hostDisplayName =
		hostLabel && shortHostId && hostLabel !== shortHostId ? `${hostLabel} (${shortHostId})` : shortHostId

	const localDaemonEnabled = useSettingsStore((state) => state.localDaemonEnabled)
	const [launchModalOpen, setLaunchModalOpen] = useState(false)
	const launchDaemon = useLaunchDaemon({
		syncMode: syncForceMode,
		tokenFactory: (hostId) => client.auth.daemon.token.create({ hostId }),
		userId: user?.id ?? null,
		organizationId: organizationId ?? null,
	})

	return {
		isColocated,
		isHostOffline,
		isHostStarting,
		isHostUpdating,
		canLaunchLocalDaemon: canLaunchLocalDaemon && localDaemonEnabled,
		hostDisplayName,
		statusHost,
		usageLimits,
		launchDaemon,
		launchModalOpen,
		setLaunchModalOpen,
	}
}
