import type { CheckRowType, PullRequestRowType } from '@humanlayer/streams/pr-status'
import { formatCheckPrompt } from '@humanlayer/ui/lib/github/export-check-prompt'
import { useCallback, useRef, useState } from 'react'

import { useSessionDelivery } from '@/components/comment-delivery/useSessionDelivery'
import { useSessionDeliveryCapability } from '@/components/comment-delivery/useSessionDeliveryCapability'

import { groupChecks } from './check-groups'

export type PrPromptDeliveryKind = 'send' | 'queue' | 'copy'

/** Which checks a send is about: every failing one, or the ones named. */
export type CheckSelection = readonly string[] | null

export interface PrPromptDelivery {
	/** `copy` when no agent can take the prompt right now: the control copies it instead. */
	readonly kind: PrPromptDeliveryKind
	readonly pending: boolean
	/** The selection being sent, so the control that was pressed can say so. */
	readonly pendingSelection: CheckSelection | undefined
	readonly error: string | null
	readonly sendChecks: (selection: CheckSelection) => void
}

const MESSAGES = {
	sent: 'The failing checks have been sent to the agent.',
	queued: 'Agent is currently working. The failing checks have been queued.',
	copied: 'Prompt copied. Paste it into a session to fix the checks.',
} as const

const selectFailing = (checks: readonly CheckRowType[], selection: CheckSelection): CheckRowType[] => {
	const failing = groupChecks(checks).failed
	if (selection === null) return failing
	const wanted = new Set(selection)
	return failing.filter((check) => wanted.has(check.name))
}

/**
 * The "Send to Agent" behind a failing check: write a prompt from what the panel already shows
 * and hand it to the session the way artifact feedback is handed over. Null without a session,
 * as on a task page, where there is none to send to.
 */
export function usePrPromptDelivery(input: {
	readonly sessionId: string | null
	readonly pullRequest: PullRequestRowType | null
	readonly checks: readonly CheckRowType[]
}): PrPromptDelivery | null {
	const { sessionId, pullRequest, checks } = input
	const capability = useSessionDeliveryCapability({ sessionId: sessionId ?? undefined })
	const session = useSessionDelivery(capability, MESSAGES)
	const [pending, setPending] = useState(false)
	const [pendingSelection, setPendingSelection] = useState<CheckSelection | undefined>(undefined)
	const [error, setError] = useState<string | null>(null)
	const pendingRef = useRef(false)

	const sendChecks = useCallback(
		(selection: CheckSelection) => {
			if (pendingRef.current) return
			const selected = selectFailing(checks, selection)
			if (pullRequest === null || selected.length === 0) {
				setError('Nothing is failing on the current commit any more.')
				return
			}
			pendingRef.current = true
			setPending(true)
			setPendingSelection(selection)
			setError(null)
			const text = formatCheckPrompt({ pullRequest, checks: selected })
			void (async () => {
				let accepted = false
				try {
					if (capability.kind === 'copy') {
						if (!(await session.copy(text))) setError('Prompt could not be copied.')
						return
					}
					const acceptance = await session.dispatch(text)
					if (acceptance.kind === 'rejected') {
						setError(`Delivery rejected: ${acceptance.reason}`)
						return
					}
					accepted = true
					await session.confirm(acceptance)
				} catch {
					// Past acceptance the agent has the prompt, and a sync confirmation that fails
					// afterwards would otherwise contradict the toast that already reported it.
					if (!accepted) setError('Prompt could not be delivered.')
				} finally {
					pendingRef.current = false
					setPending(false)
					setPendingSelection(undefined)
				}
			})()
		},
		[capability.kind, checks, pullRequest, session],
	)

	if (sessionId === null) return null
	return { kind: capability.kind, pending, pendingSelection, error, sendChecks }
}
