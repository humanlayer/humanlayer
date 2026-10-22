import type { Session } from '@humanlayer/db/tables/sessions'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { uuidv7 } from 'uuidv7'

import { useSyncInternal } from '@/components/providers/SyncProvider'
import { handoffTitle } from '@/lib/harness-handoff'
import { Dialog } from '@/minimalist/components/Dialog'
import { TextDialog } from '@/minimalist/components/TextDialog'
import { AGENT_NAMES, AGENT_PROVIDERS, effortFor, type ModelOption } from '@/minimalist/lib/models'
import { sessionName } from '@/minimalist/lib/session-name'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

// Fork and hand-off both start a new session from this one's conversation, then open it once it syncs.

/** Opens a session the server just created, once sync has it, so the thread never flashes "doesn't exist". */
function useOpenNewSession() {
	const { confirmTx } = useSyncInternal()
	const navigate = useNavigate()
	return async (result: { transactionId: string; session: { id: string } }) => {
		await confirmTx.sessions(result.transactionId)
		await navigate({ to: '/sessions/$sessionId', params: { sessionId: result.session.id } })
	}
}

/** Rewrites one of your messages and starts a new session from there; both keep the same files. */
export function ForkDialog({
	session,
	from,
	onClose,
}: {
	session: Session
	from: { id: string; text: string }
	onClose: () => void
}) {
	const { client: api } = useRiptideApi()
	const open = useOpenNewSession()
	return (
		<TextDialog
			title="Fork session"
			description="Start a new session with the earlier messages and this replacement prompt. Both sessions use the same files."
			initialValue={from.text}
			submitLabel="Fork session"
			multiline
			onClose={onClose}
			onSave={async (text) => {
				const codingAgent = session.coding_agent
				if (codingAgent !== 'claude' && codingAgent !== 'codelayer' && codingAgent !== 'fold')
					throw new Error('Unsupported fork')
				await open(
					await api.sessions.v2.fork({
						id: uuidv7(),
						eventId: uuidv7(),
						codingAgent,
						sourceSessionId: session.id,
						forkAtEventId: from.id,
						text,
						title: null,
						archiveSource: false,
					}),
				)
			}}
		/>
	)
}

/** Moves the conversation to the other agent in a new session of the same task. This one stays as it is. */
export function HandoffDialog({
	session,
	model,
	onClose,
}: {
	session: Session
	model: ModelOption
	onClose: () => void
}) {
	const { client: api } = useRiptideApi()
	const open = useOpenNewSession()
	const action = useAction('inline')
	const [includeToolCalls, setIncludeToolCalls] = useState(true)
	const agent = AGENT_NAMES[model.agent]
	return (
		<Dialog
			title={`Hand off to ${agent}`}
			description={`${agent} continues on ${model.label} in a new session with the conversation so far and the same files. This session stays as it is.`}
			busy={action.pending}
			error={action.error}
			onClose={onClose}
			onSubmit={() =>
				void action.run(async () => {
					await open(
						await api.sessions.handoff({
							id: uuidv7(),
							eventId: uuidv7(),
							sourceSessionId: session.id,
							codingAgent: model.agent,
							provider: AGENT_PROVIDERS[model.agent],
							model: model.value,
							effort: effortFor(model, session.effort ?? null),
							includeToolCalls,
							title: handoffTitle(sessionName(session, ''), agent),
						}),
					)
				}, 'Could not hand off the session. It is unchanged. Try again.')
			}
		>
			<label className="check-row">
				<input
					type="checkbox"
					checked={includeToolCalls}
					disabled={action.pending}
					onChange={(event) => setIncludeToolCalls(event.target.checked)}
				/>
				Include tool calls and results
			</label>
			<div className="dialog-actions">
				<button type="button" className="btn" onClick={onClose} disabled={action.pending}>
					Cancel
				</button>
				<button type="submit" className="btn primary" disabled={action.pending} autoFocus>
					{action.pending ? 'Handing off…' : 'Hand off'}
				</button>
			</div>
		</Dialog>
	)
}
