import {
	type ClaudeUsageLimits,
	mostConstrainedUsageWindow,
	usageLimitsRelevantToModel,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { useLocalStorage } from '@uidotdev/usehooks'
import { useMemo } from 'react'

import { USAGE_LIMIT_NOTICE_DISMISSED_KEY } from '@/lib/preferences'

import { lastResetUsedUpWindow } from './usage-limit-presentation'

interface UsageLimitNoticeState {
	limits: ClaudeUsageLimits | null
	show: boolean
	onDismiss: () => void
}

const PARKED_WITHOUT_WINDOW = { id: 'parked', resetsAt: null }
const DISMISSAL_RETENTION_MS = 86_400_000

/** Dismissed windows mapped to when the entry may be dropped: a day past the window's reset. */
type DismissedUsageWindows = Record<string, number>

function withDismissal(dismissed: DismissedUsageWindows, windowKey: string, resetsAt: number | null, now: number) {
	const unexpired = Object.fromEntries(Object.entries(dismissed).filter(([, expiresAt]) => expiresAt > now))
	return { ...unexpired, [windowKey]: Math.max(resetsAt ?? now, now) + DISMISSAL_RETENTION_MS }
}

function noticeWindow(
	limits: ClaudeUsageLimits | null,
	isParked: boolean,
	now: number = Date.now(),
): { id: string; resetsAt: number | null } | undefined {
	const constrained = mostConstrainedUsageWindow(limits, now)
	if (constrained) return { id: constrained.id, resetsAt: constrained.window.resets_at }
	if (!isParked) return undefined
	return lastResetUsedUpWindow(limits, now) ?? PARKED_WITHOUT_WINDOW
}

export function useUsageLimitNotice({
	hostUsageLimits,
	model,
	resolvedModel,
	isParked,
	suppressed,
}: {
	hostUsageLimits: ClaudeUsageLimits | null | undefined
	model: string | null | undefined
	resolvedModel: string | null | undefined
	isParked: boolean
	suppressed: boolean
}): UsageLimitNoticeState {
	const limits = useMemo(
		() => usageLimitsRelevantToModel(hostUsageLimits, resolvedModel ?? model),
		[hostUsageLimits, resolvedModel, model],
	)
	const usageWindow = noticeWindow(limits, isParked)
	const windowKey = usageWindow ? `${usageWindow.id}:${usageWindow.resetsAt ?? ''}` : null
	const [dismissed, setDismissed] = useLocalStorage<DismissedUsageWindows>(USAGE_LIMIT_NOTICE_DISMISSED_KEY, {})
	const isDismissed = windowKey !== null && windowKey in dismissed
	const show = !suppressed && usageWindow !== undefined && !isDismissed
	return {
		limits,
		show,
		onDismiss: () => {
			if (!usageWindow || !windowKey) return
			setDismissed(withDismissal(dismissed, windowKey, usageWindow.resetsAt, Date.now()))
		},
	}
}
