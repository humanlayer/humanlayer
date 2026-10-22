import { AGENT_LABELS, launcherProviderForAgent } from '@humanlayer/ui/constants/agents'
import { getModelOptionsForAgentProvider } from '@humanlayer/ui/constants/models'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { uuidv7 } from 'uuidv7'

import { useSessionDetail } from '@/components/session-detail/session-detail-context'
import { useSessionActions } from '@/hooks/useSessionActions'
import { handoffBlockedReason, handoffTarget, handoffTitle, type HandoffTarget } from '@/lib/harness-handoff'

function agentDisplayName(agent: string): string {
	return AGENT_LABELS[agent as HandoffTarget] ?? agent
}

/**
 * Hand off the current session to the other coding agent: derives target and
 * eligibility, owns the dialog state, and on confirm creates a new session
 * seeded with the transcript and navigates to it once the server persists it.
 */
export function useHarnessHandoff() {
	const { sessionId, session, canManageSession, host } = useSessionDetail()
	const { handoffSession } = useSessionActions()
	const navigate = useNavigate()
	const [isOpen, setIsOpen] = useState(false)
	const [pending, setPending] = useState(false)

	const target = session ? handoffTarget(session) : null
	const hostDisconnected = host.isHostOffline || host.isHostStarting
	const blockedReason = session ? handoffBlockedReason(session, canManageSession, hostDisconnected) : null

	const modelOptions = useMemo(() => {
		if (!target) return []
		return getModelOptionsForAgentProvider({ agent: target, provider: launcherProviderForAgent(target) })
	}, [target])

	const confirm = useCallback(
		async (input: { model: string; includeToolCalls: boolean }) => {
			if (!session || !target || pending) return
			const newSessionId = uuidv7()
			setPending(true)
			try {
				const transaction = handoffSession({
					id: newSessionId,
					eventId: uuidv7(),
					sourceSessionId: sessionId,
					codingAgent: target,
					provider: launcherProviderForAgent(target),
					model: input.model,
					includeToolCalls: input.includeToolCalls,
					title: handoffTitle(session.title, AGENT_LABELS[target]),
					placeholderContent: `Handed off from ${agentDisplayName(session.coding_agent)}…`,
					sourceSession: {
						task_id: session.task_id,
						working_directory: session.working_directory,
						host_id: session.host_id,
						coding_agent: session.coding_agent,
						provider: session.provider,
						model: session.model,
						permissions_mode: session.permissions_mode as 'default' | 'accept_edits' | 'bypass',
						resource_owner_user_id: session.resource_owner_user_id,
					},
				})
				await transaction.isPersisted.promise
				setIsOpen(false)
				navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
			} catch {
				toast.error('Could not hand off the session')
			} finally {
				setPending(false)
			}
		},
		[session, target, pending, sessionId, handoffSession, navigate],
	)

	return {
		visible: !!session && !!target && canManageSession,
		blockedReason,
		target,
		targetLabel: target ? AGENT_LABELS[target] : '',
		modelOptions,
		isOpen,
		pending,
		open: useCallback(() => setIsOpen(true), []),
		close: useCallback(() => {
			if (!pending) setIsOpen(false)
		}, [pending]),
		confirm,
	}
}
