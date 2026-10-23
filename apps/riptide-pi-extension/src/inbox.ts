// Web messages (plan-part-2.md phase 4). riptide-daemon learns of a web reply from its Electric
// shape of sessions: the API sets `prompt` and moves the row to `resuming`, or to
// `interrupt_requested` for a stop. This lane follows the same shape, with the daemon token, and
// hands such changes for the bound session to the Mirror. The first snapshot only records where
// things stand, so a restart does not replay an old prompt. It also tells the web composer which
// skills this session has, so the composer offers them as `/skill:name`.

import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent'
import { type SessionRow, sessionCommand, ShapeReader } from '@humanlayer/session-sdk-sessions'

import { type AgentSkill, daemonCall } from './api.ts'
import { withDaemonToken } from './auth.ts'
import { codingAgent, getChannelConfig, log } from './config.ts'
import type { LaneHost, Participant, WebInbox } from './lane.ts'
import { loopLane } from './loop.ts'
import { backoffMs } from './outbox.ts'
import { errorMessage } from './util.ts'

export function inboxLane(host: LaneHost): Participant | undefined {
	if (!host.web) return undefined
	void reportSkills(host, host.web.skills())
	const inbox = new Inbox(host, host.web)
	return loopLane(host, {
		name: 'inbox',
		step: (signal) => withDaemonToken(host.binding.channel, signal, (token) => inbox.poll(token, signal)),
		// A live request waits on the server, so the next one goes out at once.
		pauseMs: (failures) => (failures === 0 ? 0 : backoffMs(host.backoff, failures)),
		stopOn: ['stop-all', 'stop-binding', 'skip'],
	})
}

/** One report per binding, as riptide-daemon reports once per session. A failure only costs the composer's list. */
async function reportSkills(host: LaneHost, skills: SlashCommandInfo[]): Promise<void> {
	const { channel, hostId } = host.binding
	const body = { hostId, agent: codingAgent(), workspacePath: host.cwd, commands: [], skills: skills.map(agentSkill) }
	try {
		await daemonCall(channel, 'agentCommands/report', body, host.signal)
	} catch (err) {
		if (!host.signal.aborted) log(`skills report: ${errorMessage(err)}`)
	}
}

/** pi's `user` and `project` scopes match the composer's; a skill an extension adds counts as a plugin's. */
function agentSkill(c: SlashCommandInfo): AgentSkill {
	const skill: AgentSkill = {
		name: c.name,
		scope: c.sourceInfo.scope === 'temporary' ? 'plugin' : c.sourceInfo.scope,
	}
	if (c.description) skill.description = c.description
	return skill
}

/** The bound session's row changes, from the Electric shape of its host's sessions. */
class Inbox {
	private readonly host: LaneHost
	private readonly web: WebInbox
	private readonly shape: ShapeReader<SessionRow>

	constructor(host: LaneHost, web: WebInbox) {
		this.host = host
		this.web = web
		const b = host.binding
		this.shape = new ShapeReader({ url: `${getChannelConfig(b.channel).sync}/v1/sessions/${b.hostId}` })
	}

	async poll(token: string, signal: AbortSignal): Promise<void> {
		for (const change of await this.shape.poll({ 'x-daemon-authorization': token }, signal)) {
			if (change.initial || change.value.id !== this.host.sessionId) continue
			const command = sessionCommand(change)
			if (command?.kind === 'continue' && command.prompt) this.web.resume(command.prompt)
			else if (command?.kind === 'interrupt') this.web.interrupt()
		}
	}
}
