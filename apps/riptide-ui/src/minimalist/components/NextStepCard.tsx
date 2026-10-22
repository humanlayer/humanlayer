import type { Session } from '@humanlayer/db/tables/sessions'
import type { Task } from '@humanlayer/db/tables/tasks'
import { useNavigate } from '@tanstack/react-router'
import { useLocalStorage } from '@uidotdev/usehooks'
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffectEvent, useMemo } from 'react'
import { uuidv7 } from 'uuidv7'

import { useExistingSessionForNextStep } from '@/hooks/live-queries/useExistingSessionForNextStep'
import { useMountEffect } from '@/hooks/useMountEffect'
import type { HostView } from '@/minimalist/lib/data'
import { launchInTask } from '@/minimalist/lib/launch'
import { sessionSettings } from '@/minimalist/lib/models'
import { parseNextStep } from '@/minimalist/lib/next-step'
import { phaseOf } from '@/minimalist/lib/phases'
import { useAction } from '@/minimalist/lib/use-action'
import { useRiptideApi } from '@/orpc/client'

/**
 * The end of a phase: what the agent suggests next, and one button to start it
 * as a new session in the same task. Replaces the graph, the proceed button and
 * the phase tips. Hiding it folds it into a thin row for that session, which
 * stays folded until opened again; ⇧⌘⏎ still works while it is folded.
 */
export function NextStepCard({
	session,
	task,
	host,
}: {
	session: Session
	task: Pick<Task, 'id' | 'workspace_id'>
	host: HostView | null
}) {
	const { client: api } = useRiptideApi()
	const navigate = useNavigate()
	const action = useAction()
	const step = useMemo(() => parseNextStep(session.next_step_suggestions), [session.next_step_suggestions])
	const { siblingSessionId } = useExistingSessionForNextStep(
		task.id,
		step?.targetLabel ?? null,
		session.created_at,
		session.id,
	)
	const hostOnline = host?.online ?? false
	const [hidden, setHidden] = useLocalStorage<boolean>(`hl-min-next-step-hidden-${session.id}`, false)

	const proceed = async () => {
		if (!step || action.pending) return
		if (siblingSessionId) {
			await navigate({ to: '/tasks/$taskId', params: { taskId: task.id }, search: { session: siblingSessionId } })
			return
		}
		if (!hostOnline) return
		const sessionId = uuidv7()
		const started = await action.run(
			() =>
				launchInTask(api, task, {
					sessionId,
					eventId: uuidv7(),
					text: step.prompt,
					hostId: session.host_id,
					workingDirectory: step.suggestedDirectory ?? session.working_directory,
					settings: sessionSettings(session),
				}),
			'Could not start the next session. Check that the host is online and try again.',
		)
		if (started)
			await navigate({ to: '/tasks/$taskId', params: { taskId: task.id }, search: { session: sessionId } })
	}

	const onShortcut = useEffectEvent(() => void proceed())
	useMountEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Enter' || !event.shiftKey || !(event.metaKey || event.ctrlKey) || event.defaultPrevented)
				return
			event.preventDefault()
			onShortcut()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})

	if (!step) return null
	const existing = siblingSessionId !== null
	const phase = step.targetLabel ? phaseOf({ labels: [{ name: step.targetLabel }] }) : null
	if (hidden)
		return (
			<button
				type="button"
				className="next-row"
				aria-label={`Show next step: ${step.action}`}
				onClick={() => setHidden(false)}
			>
				<span className="k">Next step</span>
				<span className="t">{step.action}</span>
				<ChevronRight className="i sm" />
			</button>
		)
	return (
		<div className="next-card" role="group" aria-label="Next step">
			<div className="body">
				<div className="k">Next</div>
				<div className="t">{step.action}</div>
				<div className="d">
					{existing ? (
						`The ${phase?.toLowerCase() ?? 'next'} session already started.`
					) : hostOnline ? (
						<>
							Starts a new session in this task
							{step.command ? (
								<>
									{' '}
									with <code>{step.command}</code>
								</>
							) : null}
							.
						</>
					) : (
						'The host is offline. Start its daemon to continue.'
					)}
				</div>
			</div>
			<button
				type="button"
				className="btn primary"
				disabled={action.pending || (!existing && !hostOnline)}
				onClick={() => void proceed()}
			>
				{existing ? `Open ${phase ?? 'session'}` : 'Continue'}
				<span className="kbd inv">⇧⌘⏎</span>
				<ArrowRight className="i sm" />
			</button>
			<button
				type="button"
				className="iconbtn next-hide"
				aria-label="Hide next step"
				title="Hide next step"
				onClick={() => setHidden(true)}
			>
				<ChevronDown className="i sm" />
			</button>
		</div>
	)
}
