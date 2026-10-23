import type { Session } from '@humanlayer/db/tables/sessions'
import {
	mostConstrainedUsageWindow,
	usageLimitsRelevantToModel,
	usageWindowLabel,
} from '@humanlayer/schemas/zod/host/usage-limits'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Clock, Eye, Server } from 'lucide-react'

import { formatUsageReset } from '@/components/usage-limits/format-usage-reset'
import { useMemberName } from '@/minimalist/lib/access'
import { DAEMON_START_COMMAND, type HostView, useHosts, useTask } from '@/minimalist/lib/data'
import { formatAgo } from '@/minimalist/lib/format'
import { stopReason } from '@/minimalist/lib/status'
import { useCopy } from '@/minimalist/lib/use-copy'

/**
 * Why the agent isn't working, in one block above the composer: the host is
 * gone, the usage limit hit, or the session stopped short and what restarts it.
 */
export function SessionNotice({
	session,
	host,
	taskId,
}: {
	session: Session
	host: HostView | null
	taskId: string | null
}) {
	const navigate = useNavigate()
	const copy = useCopy()
	const hostName = host?.name ?? 'The host'
	const { task } = useTask(taskId)
	const { hosts } = useHosts()
	// A project task can pick up on another host from its pushed branch; a directory task can't leave its host.
	const other = task?.workspace_id ? hosts.find((entry) => entry.online) : undefined
	if (host && !host.online && session.status !== 'draft') {
		return (
			<div className="notice" role="status">
				<Server className="i sm" strokeWidth={1.6} />
				<div className="body">
					<b>{hostName} is offline</b>
					<div className="d">
						This session runs on {hostName}, last seen {formatAgo(host.lastSeen)}. Start the daemon there to
						keep going
						{other
							? `, or continue in a new session on ${other.name}. It picks up the task's branch as last pushed.`
							: '.'}
					</div>
					<div className="acts">
						<button
							type="button"
							className="btn"
							title={DAEMON_START_COMMAND}
							onClick={() =>
								copy(
									DAEMON_START_COMMAND,
									`Start command copied. Run it on ${hostName}.`,
									`Could not copy the command. Run ${DAEMON_START_COMMAND} on ${hostName}.`,
								)
							}
						>
							Copy start command
						</button>
						{taskId && other ? (
							<>
								<span className="sp" />
								<button
									type="button"
									className="btn primary"
									onClick={() =>
										void navigate({ to: '/', search: { task: taskId, host: other.host.host_id } })
									}
								>
									Continue on {other.name}
								</button>
							</>
						) : null}
					</div>
				</div>
			</div>
		)
	}
	const stopped = stopReason(session, host?.name ?? 'the host')
	if (stopped) {
		const { command } = stopped
		return (
			<div className="notice fail" role="status">
				<AlertTriangle className="i sm" strokeWidth={1.6} />
				<div className="body">
					<b>{stopped.title}</b>
					<div className="d">{stopped.detail}</div>
					{stopped.error ? <pre className="log">{stopped.error}</pre> : null}
					{command ? (
						<div className="acts">
							<button
								type="button"
								className="btn"
								title={command}
								onClick={() =>
									copy(
										command,
										`Sign-in command copied. Run it on ${hostName}.`,
										`Could not copy the command. Run ${command} on ${hostName}.`,
									)
								}
							>
								Copy sign-in command
							</button>
						</div>
					) : null}
				</div>
			</div>
		)
	}
	if (session.status !== 'waiting_for_usage_limit') return null
	const limits = usageLimitsRelevantToModel(host?.host.coding_agent_usage_limits?.claude, session.model)
	const worst = mostConstrainedUsageWindow(limits)
	const reset = formatUsageReset(worst?.window.resets_at)
	return (
		<div className="notice warn" role="status">
			<Clock className="i sm" strokeWidth={1.6} />
			<div className="body">
				<b>Claude usage limit reached{host ? ` on ${host.name}` : ''}</b>
				<div className="d">
					{reset && worst
						? `The ${usageWindowLabel(worst.id)} limit resets at ${reset}. The session continues then, and messages you send now wait until it does.`
						: 'The session continues when the limit resets. Messages you send now wait until then.'}
				</div>
			</div>
		</div>
	)
}

/** Stands in for the composer in someone else's session: who can prompt, whether the agent waits on them, and how to get a turn. */
export function ReadOnlyNotice({ session, waiting }: { session: Session; waiting: boolean }) {
	const nameOf = useMemberName()
	const owner = nameOf(session.created_by)
	return (
		<div className="notice" role="status">
			<Eye className="i sm" strokeWidth={1.6} />
			<div className="body">
				<b>
					{waiting ? `The agent is waiting on ${owner} to answer` : `Only ${owner} can prompt this session`}
				</b>
				<div className="d">You can read along here. To send messages, ask {owner} to let you prompt.</div>
			</div>
		</div>
	)
}
