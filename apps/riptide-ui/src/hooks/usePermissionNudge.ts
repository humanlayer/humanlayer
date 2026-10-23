import { useCallback, useMemo } from 'react'

import { useBypassNudgeStore } from '@/hooks/stores/bypassNudgeStore'

const NUDGE_THRESHOLD = 5

export function usePermissionNudge({
	sessionId,
	approvals,
	silenced,
	permissionsMode,
}: {
	sessionId: string
	approvals: Array<{ status: string }> | undefined
	silenced: boolean
	permissionsMode: string
}): { nudgeOpen: boolean; dismissNudge: () => void } {
	const dismissedForSession = useBypassNudgeStore((s) => s.isNudgeDismissedForSession(sessionId))
	const dismissNudgeForSession = useBypassNudgeStore((s) => s.dismissNudgeForSession)

	const approvedCount = useMemo(() => approvals?.filter((a) => a.status === 'approved').length ?? 0, [approvals])

	const nudgeOpen =
		!silenced && !dismissedForSession && permissionsMode === 'default' && approvedCount >= NUDGE_THRESHOLD

	const dismissNudge = useCallback(() => {
		dismissNudgeForSession(sessionId)
	}, [dismissNudgeForSession, sessionId])

	return { nudgeOpen, dismissNudge }
}
