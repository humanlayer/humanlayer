// The server's state for one Claude Code process: who is signed in, the channel's heartbeat and
// web-app followers, one Mirror per Claude Code session it has seen, and the work it hands the mod.
// A process runs one session at a time; /clear and an in-app resume move it to another, and the
// earlier session's mirror keeps sending what it queued.

import { spawn } from 'node:child_process'
import { hostname } from 'node:os'

import { type Identity, openBrowser, type OrgChoice } from '@humanlayer/session-sdk-auth'
import {
	ALL_CHANNELS,
	type Channel,
	errorMessage,
	isChannel,
	readJsonFile,
	resumeAll,
	writeJsonFileAtomic,
} from '@humanlayer/session-sdk-base'
import {
	claim,
	type Follower,
	followApprovals,
	followSessions,
	pickTask,
	pruneClaims,
} from '@humanlayer/session-sdk-sessions'
import { HUMANLAYER_TOOLS, runTool, TOOLS, type ToolName, toJsonSchema } from '@humanlayer/session-sdk-tools'

import {
	claimsDir,
	client,
	CODING_AGENT,
	FLUSH_MS,
	guard,
	HEARTBEAT_MS,
	linksPath,
	log,
	login,
	pendingAttachPath,
} from './config.ts'
import { Mirror, type MirrorHost } from './mirror.ts'
import type {
	Action,
	ApprovalAnswer,
	ApprovalAsk,
	CommandsReport,
	Hello,
	HelloReply,
	ModEvent,
	TextReply,
	ToolAsk,
} from './protocol.ts'
import { footer, type Status, statusText } from './status.ts'
import { transcriptPathFor } from './transcript.ts'

/** The session the process runs now, as the mod reported it. */
interface Current {
	sessionId: string
	cwd: string
	transcriptPath: string | undefined
	interactive: boolean
}

const SWITCHED_OFF = 'HumanLayer is turned off (HUMANLAYER_CLAUDE_DISABLE). Unset it and restart Claude Code to mirror.'

/** The footer is drawn again at most this often. */
const CHANGED_MS = 250

export class Host {
	readonly claudePid: number
	private current: Current | undefined
	/** Why the plugin does nothing in this process (a daemon session), once hello said so. */
	private disabled: string | undefined
	/** HUMANLAYER_CLAUDE_DISABLE=1: nothing mirrors, but status, login and logout still work. */
	private switchedOff = false
	/** Mirrors by Claude Code session id. */
	private readonly mirrors = new Map<string, Mirror>()
	/** Sessions whose saved binding was looked for and not found. */
	private readonly unlinked = new Set<string>()
	/** /humanlayer off before the first prompt: the session does not bind until on. */
	private readonly offBeforeBind = new Set<string>()
	/** /humanlayer attach in a session: the task its next prompt binds to. */
	private readonly attachTargets = new Map<string, string>()
	private readonly channels = new Map<Channel, { beat: NodeJS.Timeout; inbox: Follower; approvals: Follower }>()
	private readonly stop = new AbortController()
	private readonly actions: Action[] = []
	private readonly waiters = new Set<() => void>()
	private lastFooter: string | undefined
	private changedTimer: NodeJS.Timeout | undefined
	/** The session's slash commands and skills, from the mod. */
	private commands: CommandsReport['commands'] = []
	private reportedSkills = new Set<string>()
	/** A login's org choice, waiting for `/humanlayer login org <n>`. */
	private chooseOrg: { orgs: OrgChoice[]; pick: (org: OrgChoice | undefined) => void } | undefined
	private warnedSignedOut = false
	private startedChannel = false
	/** One tool call at a time per session: a reply reopens a thread a resolve in the same turn closed. */
	private readonly chains = new Map<string, Promise<unknown>>()

	private readonly mirrorHost: MirrorHost

	constructor(claudePid: number) {
		this.claudePid = claudePid
		this.mirrorHost = {
			notify: (message) => this.notify(message),
			changed: () => this.changed(),
			bound: (b) => this.startChannel(b.channel, b.hostId),
			act: (action) => this.act(action),
			hasCommand: (name) => this.commands.some((c) => c.name === name),
			claudePid,
		}
	}

	// ---- from the mod ----

	async hello(h: Hello): Promise<HelloReply> {
		const daemon = h.env.HUMANLAYER_SESSION_ID || h.env.HUMANLAYER_SESSION_URL
		if (daemon) {
			// riptide-daemon runs this Claude Code and mirrors it already: a second copy would double every event.
			this.disabled = 'the HumanLayer daemon runs this session and mirrors it'
			log('daemon session: the plugin stays off')
			return { disabled: this.disabled }
		}
		this.switchedOff = (h.env.HUMANLAYER_CLAUDE_DISABLE ?? process.env.HUMANLAYER_CLAUDE_DISABLE) === '1'
		if (this.switchedOff) log('HUMANLAYER_CLAUDE_DISABLE: nothing mirrors')
		if (h.pat && !process.env.HUMANLAYER_PAT) process.env.HUMANLAYER_PAT = h.pat
		client.getPat() // reads HUMANLAYER_PAT and deletes it from this process too
		for (const key of ['HUMANLAYER_TASK', 'HUMANLAYER_CHANNEL'] as const) {
			const value = h.env[key]
			if (value && !process.env[key]) process.env[key] = value
		}
		const switched = this.current?.sessionId !== h.sessionId
		this.current = {
			sessionId: h.sessionId,
			cwd: h.cwd,
			transcriptPath: h.transcriptPath,
			interactive: h.interactive,
		}
		log(`hello ${h.sessionId}${h.interactive ? '' : ' (headless)'}`)
		if (switched) await this.resumeCurrent()
		if (!this.startedChannel) {
			this.startedChannel = true
			void pruneClaims(claimsDir())
			void this.startSignedIn()
		}
		this.changed()
		if (this.switchedOff) return { tools: [] }
		const tools = HUMANLAYER_TOOLS.map((name) => ({
			name,
			description: TOOLS[name].description,
			inputSchema: toJsonSchema(TOOLS[name].params) as Record<string, unknown>,
		}))
		return { tools }
	}

	async event(e: ModEvent): Promise<void> {
		if (this.disabled || this.switchedOff) return
		const m = this.mirrors.get(e.sessionId)
		switch (e.kind) {
			case 'prompt':
				return this.prompt(e)
			case 'turn-start':
				return m?.turnStart(e.turnId)
			case 'turn-end':
				return m?.turnEnd(e.reason, e.contextWindow)
			case 'rows':
				return m?.rows()
			case 'tool-done':
				return m?.toolDone(e.toolUseId, e.tool, e.input, e.isError, e.text)
			case 'session': {
				if (this.current?.sessionId === e.sessionId && e.transcriptPath)
					this.current.transcriptPath = e.transcriptPath
				return
			}
			case 'web-failed':
				return m?.webFailed(e.reason)
			case 'end':
				log(`session ${e.sessionId} ended (${e.reason})`)
				// The process is exiting: start sending now, before Claude Code signals this server.
				if (e.reason !== 'clear' && e.reason !== 'resume') void this.shutdown()
				return
		}
	}

	/** The mod's long poll: the actions queued so far, or once one is, or [] after ms. */
	async takeActions(ms: number): Promise<Action[]> {
		if (this.actions.length === 0 && ms > 0) {
			await new Promise<void>((resolve) => {
				const done = () => {
					clearTimeout(timer)
					this.waiters.delete(done)
					resolve()
				}
				const timer = setTimeout(done, ms)
				timer.unref()
				this.waiters.add(done)
			})
		}
		return this.actions.splice(0)
	}

	private readonly asks = new Map<string, Promise<ApprovalAnswer>>()
	private askSeq = 0

	/** A permission ask, answered later through waitApproval. */
	approval(a: ApprovalAsk): { id: string } {
		const id = String(++this.askSeq)
		const m = this.mirrors.get(a.sessionId)
		const answer: Promise<ApprovalAnswer> =
			this.disabled || this.switchedOff || !m ? Promise.resolve({ behavior: 'none' }) : m.ask(a)
		this.asks.set(id, answer)
		void answer.then(() => setTimeout(() => this.asks.delete(id), 60_000).unref())
		return { id }
	}

	/** The ask's answer once there is one, or nothing after ms. */
	async waitApproval(id: string, ms: number): Promise<{ answer?: ApprovalAnswer }> {
		const answer = this.asks.get(id)
		if (!answer) return { answer: { behavior: 'none' } }
		const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), ms).unref())
		const got = await Promise.race([answer, timeout])
		return got ? { answer: got } : {}
	}

	async tool(t: ToolAsk): Promise<TextReply> {
		if (!(HUMANLAYER_TOOLS as readonly string[]).includes(t.name))
			return { text: `Unknown HumanLayer tool ${t.name}.`, isError: true }
		const target = () =>
			this.mirrors.get(t.sessionId)?.toolTarget() ?? {
				reason: 'This Claude Code session is not linked to a HumanLayer task yet. Send a prompt first.',
			}
		try {
			const text = await this.inOrder(t.sessionId, () =>
				runTool(t.name as ToolName, t.input, target, client.daemonCall, this.stop.signal),
			)
			return { text }
		} catch (err) {
			return { text: errorMessage(err), isError: true }
		}
	}

	private inOrder<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
		const run = (this.chains.get(sessionId) ?? Promise.resolve()).then(fn, fn)
		this.chains.set(
			sessionId,
			run.catch(() => undefined),
		)
		return run
	}

	/** The session's commands and skills, for the web composer. Reported once per workspace and channel. */
	async reportCommands(r: CommandsReport): Promise<void> {
		this.commands = r.commands
		const m = this.mirrors.get(r.sessionId)
		if (m) await this.reportSkills(m.channel, m.cwd)
	}

	private async reportSkills(channel: Channel, cwd: string): Promise<void> {
		const key = `${channel}:${cwd}`
		if (this.reportedSkills.has(key) || this.commands.length === 0) return
		this.reportedSkills.add(key)
		const scope = (source: string | undefined) =>
			source === 'user' ? 'user' : source === 'builtin' ? undefined : 'plugin'
		const commands = this.commands
			.filter((c) => c.kind !== 'builtin' || c.name === 'compact')
			.map((c) => {
				const out: { name: string; description?: string; scope?: 'user' | 'project' | 'plugin' } = {
					name: c.name,
				}
				if (c.description) out.description = c.description
				const s = scope(c.kind)
				if (s) out.scope = s
				return out
			})
		const body = {
			hostId: await client.hostId(channel),
			agent: CODING_AGENT,
			workspacePath: cwd,
			commands,
			skills: [],
		}
		await guard('skills report', () => client.daemonCall(channel, 'agentCommands/report', body, this.stop.signal))
		log(`reported ${commands.length} commands`)
	}

	// ---- prompts ----

	private async prompt(e: Extract<ModEvent, { kind: 'prompt' }>): Promise<void> {
		const cur = this.current
		if (!cur || cur.sessionId !== e.sessionId) return
		// The mirror's own web messages, and prompts the session didn't type (notifications), never bind.
		if (e.origin !== 'user' || this.offBeforeBind.has(e.sessionId)) return
		if (!this.mirrors.has(e.sessionId) && !this.unlinked.has(e.sessionId)) await this.resumeCurrent()
		if (this.mirrors.has(e.sessionId)) return
		const who = await client.identity(await client.resolveChannel())
		if (!who) {
			if (!this.warnedSignedOut) this.notify('Not signed in to HumanLayer. Run /humanlayer login.')
			this.warnedSignedOut = true
			return
		}
		cur.transcriptPath ??= transcriptPathFor(cur.cwd, e.sessionId)
		let attach = this.attachTargets.get(e.sessionId)
		this.attachTargets.delete(e.sessionId)
		attach ??= await this.takePendingAttach(cur.cwd)
		const pick = await pickTask({
			prefix: 'claude',
			sessionId: e.sessionId,
			cwd: cur.cwd,
			linksPath: linksPath(),
			attach,
			chosen: process.env.HUMANLAYER_TASK?.trim() || undefined,
			freshId: () => crypto.randomUUID(),
		})
		const m = await Mirror.bind(this.mirrorHost, {
			sessionId: e.sessionId,
			cwd: cur.cwd,
			transcriptPath: cur.transcriptPath,
			who,
			prompt: e.text,
			images: e.images,
			model: e.model,
			pick,
		})
		this.mirrors.set(e.sessionId, m)
		this.unlinked.delete(e.sessionId)
		this.changed()
	}

	/** The current session's saved binding: a resume, `-c`, or a reload of the plugin. */
	private async resumeCurrent(): Promise<void> {
		const cur = this.current
		if (!cur || this.switchedOff || this.mirrors.has(cur.sessionId)) return
		const who = await client.identity(await client.resolveChannel()).catch(() => null)
		if (!who) return
		const m = await Mirror.resume(this.mirrorHost, cur.sessionId, who, cur.transcriptPath)
		if (m) this.mirrors.set(cur.sessionId, m)
		else this.unlinked.add(cur.sessionId)
	}

	// ---- the channel: heartbeat, inbox, approvals ----

	private async startSignedIn(): Promise<void> {
		await guard('start', async () => {
			const channel = await client.resolveChannel()
			const who = await client.identity(channel)
			if (!who) return
			this.startChannel(channel, await client.hostId(channel))
			await this.endLostRuns(channel, who)
		})
	}

	/** Turns a Claude Code process left running when it died end now, not when someone resumes them. */
	private async endLostRuns(channel: Channel, who: Identity): Promise<void> {
		const cwd = this.current?.cwd
		if (!cwd || this.switchedOff) return
		for (const sessionId of await Mirror.lostRuns(channel, cwd)) {
			if (this.mirrors.has(sessionId)) continue
			// Resume ends the lost turn; the mirror then sends nothing more until its session runs again.
			const m = await Mirror.resume(this.mirrorHost, sessionId, who, undefined)
			if (m) this.mirrors.set(sessionId, m)
		}
	}

	/**
	 * The heartbeat, the inbox and the approvals follower for a channel, from the first hello while
	 * signed in. Never hosts/shutdown: that fails every active session on the host, and other Claude
	 * Code processes on this machine share it.
	 */
	private startChannel(channel: Channel, hostId: string): void {
		if (this.disabled || this.switchedOff || this.stop.signal.aborted) return
		const running = this.channels.get(channel)
		if (running) {
			if (running.inbox.isStopped) running.inbox = this.followInbox(channel, hostId)
			if (running.approvals.isStopped) running.approvals = this.followAnswers(channel)
			return
		}
		const beat = {
			hostId,
			hostName: hostname(),
			// This host only mirrors sessions a user started, so the web app offers no launches there.
			capabilities: ['attachedSessionsOnly', `agent:${CODING_AGENT}`],
			canSelfUpdate: false,
		}
		const once = () => guard('heartbeat', () => client.daemonCall(channel, 'hosts/heartbeat', beat))
		void once()
		const timer = setInterval(once, HEARTBEAT_MS)
		timer.unref()
		this.channels.set(channel, {
			beat: timer,
			inbox: this.followInbox(channel, hostId),
			approvals: this.followAnswers(channel),
		})
		const cwd = this.current?.cwd
		if (cwd) void this.reportSkills(channel, cwd)
	}

	/** Web messages and stops for the session this process runs. */
	private followInbox(channel: Channel, hostId: string): Follower {
		return followSessions({
			client,
			channel,
			hostId,
			target: async (cloudSessionId) => {
				const cur = this.current
				const m = cur && this.mirrors.get(cur.sessionId)
				// Only the session open here can take a message: another one runs it when it opens.
				return m?.cloudSessionId === cloudSessionId ? m : undefined
			},
			claim: (key) => claim(claimsDir(), key),
			log,
			signal: this.stop.signal,
		})
	}

	private followAnswers(channel: Channel): Follower {
		return followApprovals({
			client,
			channel,
			log,
			signal: this.stop.signal,
			answered: (id, approved, comment) => {
				for (const m of this.mirrors.values()) if (m.answered(id, approved, comment)) return
			},
		})
	}

	// ---- /humanlayer ----

	async command(args: string): Promise<string> {
		const [sub = 'status', ...rest] = args.trim().split(/\s+/).filter(Boolean)
		const arg = rest.join(' ')
		const sessionId = this.current?.sessionId
		switch (sub) {
			case 'status':
				return statusText(await this.status())
			case 'session': {
				const url = sessionId ? this.mirrors.get(sessionId)?.info().url : undefined
				if (!url) return 'This session is not linked yet: its next prompt links it.'
				if (process.env.HUMANLAYER_CLAUDE_NO_BROWSER === '1') return url
				return (await copy(url)) ? `${url}\n(copied)` : url
			}
			case 'open-session': {
				const url = sessionId ? this.mirrors.get(sessionId)?.info().url : undefined
				if (!url) return 'This session is not linked yet: its next prompt links it.'
				if (process.env.HUMANLAYER_CLAUDE_NO_BROWSER !== '1') openBrowser(url)
				return `Opened ${url}`
			}
			case 'login':
				if (rest[0] === 'org') return this.pickOrg(rest[1])
				return this.startLogin(rest[0])
			case 'logout':
				return this.logout(rest[0])
			case 'attach':
				return this.attach(arg)
			case 'off':
			case 'on':
				return this.setOff(sub === 'off')
			default:
				return 'Use /humanlayer status, session, open-session, login [channel], logout [channel], attach <task|new>, off or on.'
		}
	}

	private async channelOf(name: string | undefined): Promise<Channel | undefined> {
		if (name === undefined) return client.resolveChannel()
		return isChannel(name) ? name : undefined
	}

	private async startLogin(name: string | undefined): Promise<string> {
		if (this.disabled) return `HumanLayer is off: ${this.disabled}.`
		const ch = await this.channelOf(name)
		if (!ch) return `Unknown channel. Use ${ALL_CHANNELS.join(', ')}.`
		const waiting = login.pendingLogin(ch)
		if (waiting?.url && waiting.code)
			return `A login is waiting: open ${waiting.url} and check the code is ${waiting.code}.`
		const codeShown = new Promise<string>((resolve) => {
			void login
				.startDeviceLogin(ch, {
					hasUI: true,
					showCode: (url, code) =>
						resolve(`Signing in to HumanLayer (${ch}): open ${url} and check the code is ${code}.`),
					pickOrg: (orgs, current) =>
						new Promise<OrgChoice | undefined>((pick) => {
							this.chooseOrg = { orgs, pick }
							const list = orgs.map(
								(o, i) => `  ${i + 1}. ${o.organizationName}${o === current ? ' (current)' : ''}`,
							)
							this.notify(`Pick an organization with /humanlayer login org <number>:\n${list.join('\n')}`)
							this.changed()
						}),
				})
				.then((creds) => {
					if (!creds) return this.notify('Login cancelled.')
					this.warnedSignedOut = false
					resumeAll()
					void this.startSignedIn().then(() => this.resumeCurrent())
					this.notify(`Signed in to HumanLayer (${ch}) as ${creds.email}, org ${creds.orgName}.`)
				})
				.catch((err) => {
					resolve(`Login failed: ${errorMessage(err)}`)
					this.notify(`Login failed: ${errorMessage(err)}`)
				})
				.finally(() => this.changed())
			this.changed()
		})
		// The code usually arrives at once; the login itself waits for the browser.
		return Promise.race([
			codeShown,
			new Promise<string>((r) => setTimeout(() => r(`Signing in to HumanLayer (${ch})…`), 5000).unref()),
		])
	}

	private pickOrg(n: string | undefined): string {
		const choose = this.chooseOrg
		if (!choose) return 'No login is waiting for an organization.'
		const org = choose.orgs[Number.parseInt(n ?? '', 10) - 1]
		if (!org) return `Pick a number from 1 to ${choose.orgs.length}.`
		this.chooseOrg = undefined
		choose.pick(org)
		this.changed()
		return `Organization: ${org.organizationName}.`
	}

	private async logout(name: string | undefined): Promise<string> {
		const ch = await this.channelOf(name)
		if (!ch) return `Unknown channel. Use ${ALL_CHANNELS.join(', ')}.`
		await login.logout(ch)
		this.changed()
		return `Signed out of HumanLayer (${ch}).`
	}

	private async attach(target: string): Promise<string> {
		if (this.disabled) return `HumanLayer is off: ${this.disabled}.`
		if (this.switchedOff) return SWITCHED_OFF
		if (!target) return 'Use /humanlayer attach <task id or slug>, or /humanlayer attach new.'
		const what = target === 'new' ? 'a new task' : `task ${target}`
		const cur = this.current
		if (!cur) return 'No session yet.'
		const m = this.mirrors.get(cur.sessionId)
		if (m) {
			await m.detach()
			this.mirrors.delete(cur.sessionId)
		}
		this.offBeforeBind.delete(cur.sessionId)
		this.attachTargets.set(cur.sessionId, target)
		// Kept on disk too, so a restart before the next prompt still joins it.
		await this.savePendingAttach(cur.cwd, target)
		this.changed()
		return `The next prompt starts a HumanLayer session in ${what}.`
	}

	private async savePendingAttach(cwd: string, target: string): Promise<void> {
		const saved = (await readJsonFile<Record<string, string>>(pendingAttachPath())) ?? {}
		saved[cwd] = target
		await writeJsonFileAtomic(pendingAttachPath(), saved)
	}

	private async takePendingAttach(cwd: string): Promise<string | undefined> {
		const saved = await readJsonFile<Record<string, string>>(pendingAttachPath())
		const target = saved?.[cwd]
		if (!saved || !target) return undefined
		delete saved[cwd]
		await writeJsonFileAtomic(pendingAttachPath(), saved)
		return target
	}

	private async pendingAttach(cwd: string): Promise<string | undefined> {
		return (await readJsonFile<Record<string, string>>(pendingAttachPath()))?.[cwd]
	}

	private setOff(off: boolean): string {
		if (this.disabled) return `HumanLayer is off: ${this.disabled}.`
		if (this.switchedOff) return SWITCHED_OFF
		const cur = this.current
		if (!cur) return 'No session yet.'
		const m = this.mirrors.get(cur.sessionId)
		if (m) m.setOff(off)
		else if (off) this.offBeforeBind.add(cur.sessionId)
		else this.offBeforeBind.delete(cur.sessionId)
		this.changed()
		return off ? 'Mirroring is off for this session.' : 'Mirroring is on for this session.'
	}

	async status(): Promise<Status> {
		const channel = await client.resolveChannel()
		const out: Status = { channel }
		if (this.disabled) {
			out.disabled = this.disabled
			return out
		}
		const who = await client.identity(channel).catch(() => null)
		if (who) out.signedIn = { email: who.email, org: who.orgName, source: who.source }
		if (this.chooseOrg) out.orgs = this.chooseOrg.orgs.map((o) => o.organizationName)
		const pending = login.pendingLogin(channel)
		if (pending) {
			out.pending = {}
			if (pending.url) out.pending.url = pending.url
			if (pending.code) out.pending.code = pending.code
		}
		if ([...this.mirrors.values()].some((m) => m.loginRequired)) out.loginRequired = true
		if (this.switchedOff) {
			out.switchedOff = true
			return out
		}
		const cur = this.current
		if (!cur) return out
		const m = this.mirrors.get(cur.sessionId)
		if (m) out.session = m.info()
		else out.session = { state: this.offBeforeBind.has(cur.sessionId) ? 'off' : 'unbound', queued: 0 }
		const attach = this.attachTargets.get(cur.sessionId) ?? (m ? undefined : await this.pendingAttach(cur.cwd))
		if (attach) out.session.attach = attach
		return out
	}

	/** The task folder section for the current session's system prompt. */
	hint(sessionId: string): string | undefined {
		return this.mirrors.get(sessionId)?.hint()
	}

	// ---- to the mod ----

	private act(action: Action): void {
		this.actions.push(action)
		for (const wake of [...this.waiters]) wake()
	}

	private notify(message: string): void {
		log(`notice: ${message.split('\n')[0]}`)
		this.act({ kind: 'toast', text: message })
	}

	/** Draws the footer again, if it changed. */
	private changed(): void {
		if (this.changedTimer) return
		this.changedTimer = setTimeout(() => {
			this.changedTimer = undefined
			void guard('footer', async () => {
				const text = footer(await this.status())
				if (text === this.lastFooter) return
				this.lastFooter = text
				this.act({ kind: 'status', text })
			})
		}, CHANGED_MS)
		this.changedTimer.unref()
	}

	private closing: Promise<void> | undefined

	/** At exit: every mirror ends its turn and sends what it can, within ms. Once, however often asked. */
	shutdown(ms = FLUSH_MS): Promise<void> {
		this.closing ??= this.close(ms)
		return this.closing
	}

	private async close(ms: number): Promise<void> {
		this.stop.abort()
		for (const { beat, inbox, approvals } of this.channels.values()) {
			clearInterval(beat)
			inbox.close()
			approvals.close()
		}
		this.channels.clear()
		await Promise.all([...this.mirrors.values()].map((m) => m.shutdown(ms)))
	}
}

/** Puts text on the system clipboard. Best effort: false when no clipboard tool ran. */
function copy(text: string): Promise<boolean> {
	const [bin = '', ...args] =
		process.platform === 'darwin'
			? ['pbcopy']
			: process.env.WAYLAND_DISPLAY
				? ['wl-copy']
				: ['xclip', '-selection', 'clipboard']
	return new Promise((resolve) => {
		const child = spawn(bin, args, { stdio: ['pipe', 'ignore', 'ignore'] })
		child.on('error', () => resolve(false))
		child.on('close', (code) => resolve(code === 0))
		child.stdin.end(text)
	})
}
