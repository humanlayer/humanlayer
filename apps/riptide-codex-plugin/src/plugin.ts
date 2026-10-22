// The plugin's MCP server process: one per Codex thread, started by Codex. It takes every hook
// (hooks.ts), keeps a Mirror per thread it sees, serves the HumanLayer tools, and while signed in
// beats for this host and follows the web app's messages, stops and approval answers. Every hook
// catches and logs: a throw would fail the user's turn.

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'

import type { Identity } from '@humanlayer/session-sdk-auth'
import { type Channel, errorMessage, sleepUnref } from '@humanlayer/session-sdk-base'
import {
	claim,
	type Follower,
	followApprovals,
	followSessions,
	type InboxTarget,
	pickTask,
	pruneClaims,
} from '@humanlayer/session-sdk-sessions'
import { HUMANLAYER_TOOLS, runTool, type ToolName, TOOLS, toJsonSchema } from '@humanlayer/session-sdk-tools'

import {
	bundledSkillsDir,
	claimsDir,
	client,
	codexDir,
	controlPath,
	daemonSession,
	guard,
	FLUSH_MS,
	HEARTBEAT_MS,
	isDisabled,
	linksPath,
	log,
	taskFromEnv,
} from './config.ts'
import { takeNextAttach, takeThreadRequest } from './control.ts'
import { addContext, denyTool, HOOK_TOOL, type HookInput, type HookOutput, parseHookInput } from './hooks.ts'
import type { CallContext, CallResult, McpTool } from './mcp.ts'
import { alive, Mirror, type MirrorHost } from './mirror.ts'
import { queueMessage as runQueue, type QueueMessage } from './queue.ts'
import { codexPrompt, loadSkills, type Skill, skillsReport } from './skills.ts'

export interface PluginOptions {
	/** How a web message reaches Codex; tests replace `codex queue`. */
	queueMessage?: QueueMessage
	/** The folder Codex started in, for crash recovery before the first hook. */
	cwd?: string
}

/** This process, as `humanlayer-codex status` finds it: `<codexDir>/live/<pid>.json`. */
export interface LiveProcess {
	pid: number
	cwd: string
	threads: string[]
}

/** The notices key for a thread not open here. */
const ANY = '*'

export function liveDir(): string {
	return join(codexDir(), 'live')
}

export function createPlugin(o: PluginOptions = {}) {
	const queueMessage = o.queueMessage ?? runQueue
	const disabled = isDisabled() || !!daemonSession()
	// Read HUMANLAYER_PAT, and delete it from this process's environment, before anything else runs.
	client.getPat()
	const startCwd = o.cwd ?? process.cwd()
	log(
		`started in ${startCwd}${disabled ? (daemonSession() ? ' (a HumanLayer daemon session: off)' : ' (disabled)') : ''}`,
	)

	/** Mirrors by thread id. null: a thread this process leaves alone (off before its first prompt). */
	const mirrors = new Map<string, Mirror | null>()
	/** The task the thread's next prompt links to, from `humanlayer-codex attach`. */
	const attachTargets = new Map<string, string>()
	/** Threads that got the task folder section since their context began. */
	const hinted = new Set<string>()
	/** Notices for the user, shown as a hook's systemMessage at the next hook that can. */
	const notices = new Map<string, string[]>()
	const channels = new Map<Channel, { beat: NodeJS.Timeout; inbox: Follower; approvals: Follower }>()
	const stop = new AbortController()
	let skills: Skill[] = []
	let warnedSignedOut = false
	let threads: { cwd: string; ids: Set<string> } = { cwd: startCwd, ids: new Set() }

	/** Work started off a hook or the inbox, which shutdown waits for. */
	const pending = new Set<Promise<unknown>>()
	const background = (work: Promise<unknown>): void => {
		pending.add(work)
		void work.finally(() => pending.delete(work))
	}

	const host: MirrorHost = {
		notify: (threadId, message) => {
			log(`notice: ${message}`)
			// A closed thread's notice shows in the thread open here.
			const to = threads.ids.has(threadId) ? threadId : ANY
			const list = notices.get(to) ?? []
			list.push(message)
			notices.set(to, list)
		},
		bound: (b) => startChannel(b.channel, b.hostId),
		deliver: (threadId, text) => queueMessage(threadId, text),
	}

	const takeNotices = (threadId: string): string | undefined => {
		const list = (notices.get(ANY) ?? []).concat(notices.get(threadId) ?? [])
		notices.delete(ANY)
		notices.delete(threadId)
		return list.length ? list.join('\n') : undefined
	}

	// ---- the channel: heartbeat, inbox, skills ----

	/**
	 * The heartbeat, the inbox and the skills report for a channel, from start while signed in.
	 * The web app shows a host offline, and turns its composer off, unless it beats as
	 * riptide-daemon does. Never hosts/shutdown: that fails every active session on the host.
	 */
	function startChannel(channel: Channel, hostId: string): void {
		if (disabled || stop.signal.aborted) return
		const running = channels.get(channel)
		if (running) {
			if (running.inbox.isStopped) running.inbox = followInbox(channel, hostId)
			if (running.approvals.isStopped) running.approvals = followAnswers(channel)
			return
		}
		const beat = {
			hostId,
			hostName: hostname(),
			// This host only runs sessions a user started on it, so the web app offers no launches there.
			capabilities: ['attachedSessionsOnly', 'agent:codex'],
			canSelfUpdate: false,
		}
		const once = () => guard('heartbeat', () => client.daemonCall(channel, 'hosts/heartbeat', beat))
		void once()
		const timer = setInterval(once, HEARTBEAT_MS)
		timer.unref()
		channels.set(channel, { beat: timer, inbox: followInbox(channel, hostId), approvals: followAnswers(channel) })
		void guard('skills report', async () => {
			const body = skillsReport(hostId, skills)
			await client.daemonCall(channel, 'agentCommands/report', body, stop.signal)
			log(`reported ${body.skills.length} skills`)
		})
	}

	function followInbox(channel: Channel, hostId: string): Follower {
		return followSessions({
			client,
			channel,
			hostId,
			target: (cloudSessionId) => webTarget(channel, cloudSessionId),
			claim: (key) => claim(claimsDir(), key),
			log,
			signal: stop.signal,
		})
	}

	function followAnswers(channel: Channel): Follower {
		return followApprovals({
			client,
			channel,
			log,
			signal: stop.signal,
			answered: (id, approved, comment, sessionId) => {
				for (const m of mirrors.values()) if (m?.answered(id, approved, comment)) return
				// An approval no hook here waits on, such as one left from a Codex that exited: the web
				// app's answer moved its session to running, though nothing runs.
				for (const m of mirrors.values()) if (m && m.cloudSessionId === sessionId) m.idleAgain()
			},
		})
	}

	/**
	 * Where a web message or stop goes. A thread open in this process takes it. A thread no live
	 * Codex has open takes it through a mirror made for the moment: its message waits in Codex's
	 * queue for a resume. A thread another live process has open is that process's.
	 */
	async function webTarget(channel: Channel, cloudSessionId: string): Promise<InboxTarget | undefined> {
		for (const m of mirrors.values()) {
			if (m?.cloudSessionId === cloudSessionId)
				return { web: (text) => m.web(codexPrompt(text, skills)), stop: () => m.stop() }
		}
		const b = await Mirror.find(channel, cloudSessionId)
		if (!b || alive(b.owner) || mirrors.has(b.threadId)) return undefined
		const who = await client.identity(channel)
		if (!who) return undefined
		const closed = async (act: (m: Mirror) => Promise<void> | void) => {
			const m = await Mirror.resume(host, b.threadId, who, { open: false })
			if (!m) return
			await act(m)
			await m.shutdown()
		}
		return {
			web: (text) =>
				background(guard('closed web message', () => closed((m) => m.webClosed(codexPrompt(text, skills))))),
			stop: () => background(guard('closed stop', () => closed((m) => m.stop()))),
		}
	}

	/** Starts the channel when signed in, and ends runs a crashed Codex left going (in cwd, if given). */
	const startSignedIn = (cwd?: string) =>
		background(
			guard('start', async () => {
				const channel = await client.resolveChannel()
				const who = await client.identity(channel)
				if (!who) return
				startChannel(channel, await client.hostId(channel))
				// Threads whose server died before it sent everything: their runs end, their rollouts go up.
				for (const threadId of await Mirror.unfinished(channel, cwd)) {
					if (mirrors.has(threadId)) continue
					const m = await Mirror.resume(host, threadId, who, { open: false })
					await m?.shutdown()
				}
			}),
		)

	// ---- threads ----

	/** The thread's mirror from its saved binding, opened here. One resume per thread, however many hooks ask at once. */
	const resuming = new Map<string, Promise<Mirror | undefined>>()
	const resumed = (threadId: string, who: Identity, transcriptPath: string | null): Promise<Mirror | undefined> => {
		const known = mirrors.get(threadId)
		if (known) return Promise.resolve(known)
		let p = resuming.get(threadId)
		if (!p) {
			p = Mirror.resume(host, threadId, who, { open: true, transcriptPath })
				.then((m) => {
					if (m) mirrors.set(threadId, m)
					return m
				})
				.finally(() => resuming.delete(threadId))
			resuming.set(threadId, p)
		}
		return p
	}

	/** Who is signed in, or a one-time notice that no one is. */
	async function signedIn(threadId: string): Promise<Identity | undefined> {
		const who = await client.identity(await client.resolveChannel())
		if (!who && !warnedSignedOut) {
			warnedSignedOut = true
			host.notify(threadId, 'HumanLayer: not signed in. Run `humanlayer-codex login`, then restart Codex.')
		}
		return who ?? undefined
	}

	/** Threads with no saved link, so hooks stop looking for one. A link takes them out. */
	const unlinked = new Set<string>()

	/** The thread's mirror: open already, or resumed from its link. Undefined when it has none. */
	async function mirrorOf(input: HookInput): Promise<Mirror | undefined> {
		const known = mirrors.get(input.session_id)
		if (known !== undefined) return known ?? undefined
		if (unlinked.has(input.session_id)) return undefined
		const who = await client.identity(await client.resolveChannel())
		const m = who ? await resumed(input.session_id, who, input.transcript_path) : undefined
		if (who && !m) unlinked.add(input.session_id)
		return m
	}

	/** What `humanlayer-codex attach|off|on` asked of this thread, applied at its next hook. */
	const controls = new Map<string, Promise<void>>()
	function applyControl(threadId: string): Promise<void> {
		// The idle timer may have consumed a request but not finished applying it.
		// A hook must wait for that transition, even if the request is gone from disk.
		const previous = controls.get(threadId) ?? Promise.resolve()
		const apply = () => applyControlOnce(threadId)
		const run = previous.then(apply, apply)
		controls.set(threadId, run)
		return run.finally(() => {
			if (controls.get(threadId) === run) controls.delete(threadId)
		})
	}

	async function applyControlOnce(threadId: string): Promise<void> {
		const req = await takeThreadRequest(threadId)
		if (!req) return
		const m = mirrors.get(threadId)
		if (req.attach) {
			if (m) await m.detach()
			mirrors.delete(threadId)
			hinted.delete(threadId)
			attachTargets.set(threadId, req.attach)
			host.notify(
				threadId,
				`HumanLayer: the next prompt starts a session in ${req.attach === 'new' ? 'a new task' : `task ${req.attach}`}.`,
			)
		}
		if (req.off !== undefined) {
			if (m) await m.setOff(req.off)
			else if (req.off) mirrors.set(threadId, null)
			else if (m === null) mirrors.delete(threadId)
			host.notify(
				threadId,
				req.off
					? 'HumanLayer: mirroring is off for this session.'
					: 'HumanLayer: mirroring is on for this session.',
			)
		}
	}

	/** The first prompt of an unlinked thread: pick the task and link. */
	async function link(input: HookInput, prompt: string): Promise<Mirror | undefined> {
		const threadId = input.session_id
		const who = await signedIn(threadId)
		if (!who || !input.transcript_path) return undefined
		const saved = attachTargets.has(threadId) ? undefined : await resumed(threadId, who, input.transcript_path)
		if (saved) return saved
		let attach = attachTargets.get(threadId)
		attachTargets.delete(threadId)
		attach ??= await takeNextAttach(input.cwd)
		const pick = await pickTask({
			prefix: 'codex',
			sessionId: threadId,
			cwd: input.cwd,
			linksPath: linksPath(),
			attach,
			chosen: taskFromEnv(),
			freshId: () => crypto.randomUUID(),
		})
		const m = await Mirror.bind(host, {
			threadId,
			cwd: input.cwd,
			who,
			prompt,
			model: input.model,
			pick,
			transcriptPath: input.transcript_path,
		})
		mirrors.set(threadId, m)
		unlinked.delete(threadId)
		return m
	}

	/** The task folder section, once per context: at the link, at a start or resume, after a compaction. */
	function hint(threadId: string, m: Mirror | undefined): string | undefined {
		if (!m || hinted.has(threadId)) return undefined
		const text = m.hint()
		if (text) hinted.add(threadId)
		return text
	}

	/** Adds the thread's notices to a hook's output, for hooks that can show them. */
	function withNotices(threadId: string, out: HookOutput): HookOutput {
		const message = takeNotices(threadId)
		return message ? { ...out, systemMessage: message } : out
	}

	async function onHook(input: HookInput, ctx: CallContext): Promise<HookOutput> {
		if (disabled || !input.session_id) return {}
		// A subagent's hooks come with its parent's session id, from the subagent's own server.
		if (ctx.threadId && ctx.threadId !== input.session_id) return {}
		const threadId = input.session_id
		await registerThread(threadId, input.cwd)
		await applyControl(threadId)
		switch (input.hook_event_name) {
			case 'SessionStart': {
				if (input.source === 'compact' || input.source === 'clear') hinted.delete(threadId)
				if (input.source === 'startup' || input.source === 'resume') startSignedIn(input.cwd)
				const m = await mirrorOf(input)
				const text = hint(threadId, m)
				return withNotices(threadId, text ? addContext('SessionStart', text) : {})
			}
			case 'UserPromptSubmit': {
				if (mirrors.get(threadId) === null) return withNotices(threadId, {})
				const m = (await mirrorOf(input)) ?? (await link(input, input.prompt ?? ''))
				if (m && !m.cloudSessionId) await waitFor(() => !!m.cloudSessionId, 2000)
				const text = hint(threadId, m)
				return withNotices(threadId, text ? addContext('UserPromptSubmit', text) : {})
			}
			case 'PreToolUse': {
				const reason = await mirrors.get(threadId)?.toolCall(input)
				return reason ? denyTool(reason) : {}
			}
			case 'PermissionRequest':
				return (await mirrors.get(threadId)?.permission(input, ctx.signal)) ?? {}
			case 'PostToolUse': {
				const reason = await mirrors.get(threadId)?.toolResult(input)
				return reason ? { decision: 'block', reason } : {}
			}
			case 'PreCompact':
			case 'PostCompact':
				mirrors.get(threadId)?.compacting(input.trigger, input.hook_event_name === 'PreCompact')
				return {}
			case 'Stop':
				return withNotices(threadId, (await mirrors.get(threadId)?.turnEnd()) ?? {})
			case 'Interrupt':
				await mirrors.get(threadId)?.interrupted()
				return {}
			default:
				return {}
		}
	}

	/** Notes this process and its threads in liveDir, for `humanlayer-codex status`. */
	async function registerThread(threadId: string, cwd: string): Promise<void> {
		if (threads.ids.has(threadId) && threads.cwd === cwd) return
		threads = { cwd, ids: new Set([...threads.ids, threadId]) }
		await writeLive()
	}

	async function writeLive(): Promise<void> {
		const live: LiveProcess = { pid: process.pid, cwd: threads.cwd, threads: [...threads.ids] }
		await mkdir(liveDir(), { recursive: true, mode: 0o700 })
		await writeFile(join(liveDir(), `${process.pid}.json`), JSON.stringify(live), { mode: 0o600 }).catch(() => {})
	}

	/** Live files of servers that died without removing theirs. */
	async function pruneLive(): Promise<void> {
		for (const name of await readdir(liveDir()).catch(() => [])) {
			const pid = Number.parseInt(name, 10)
			if (pid !== process.pid && !alive(pid)) await rm(join(liveDir(), name), { force: true })
		}
	}

	// ---- the CLI's requests between hooks ----

	/** `humanlayer-codex off|on|attach` while Codex is idle: applied within a second, not at the next prompt. */
	let controlMtime = 0
	const controlTimer = setInterval(() => {
		void guard('control', async () => {
			const info = await stat(controlPath()).catch(() => undefined)
			if (!info || info.mtimeMs === controlMtime) return
			controlMtime = info.mtimeMs
			for (const threadId of threads.ids) await applyControl(threadId)
		})
	}, 1000)
	controlTimer.unref()

	// ---- the HumanLayer tools ----

	// A reply reopens its thread, so a reply and a resolve in one turn must land in the order the
	// model made them. Codex may run them at once; this chain runs one per thread at a time.
	const chains = new Map<string, Promise<unknown>>()
	const inOrder = <T>(threadId: string, fn: () => Promise<T>): Promise<T> => {
		const run = (chains.get(threadId) ?? Promise.resolve()).then(fn, fn)
		chains.set(
			threadId,
			run.catch(() => undefined),
		)
		return run
	}

	function tools(): McpTool[] {
		if (disabled) return []
		// Reads and replies on the session's own task: nothing on this machine changes.
		return HUMANLAYER_TOOLS.map((name) => ({
			name,
			description: TOOLS[name].description,
			inputSchema: toJsonSchema(TOOLS[name].params),
			annotations: {
				readOnlyHint: name.startsWith('get_') || name === 'library_researcher',
				destructiveHint: false,
			},
		}))
	}

	async function call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult> {
		if (name === HOOK_TOOL) {
			const input = parseHookInput(args)
			const out: HookOutput = input
				? await onHook(input, ctx).catch((err) => {
						log(`hook ${input.hook_event_name}: ${errorMessage(err)}`)
						return {}
					})
				: {}
			return { text: JSON.stringify(out) }
		}
		if (!(HUMANLAYER_TOOLS as readonly string[]).includes(name))
			return { text: `Unknown tool ${name}`, isError: true }
		const threadId = ctx.threadId ?? ''
		const target = () =>
			mirrors.get(threadId)?.toolTarget() ?? { reason: 'This Codex session is not linked to a HumanLayer task.' }
		try {
			const text = await inOrder(threadId, () =>
				runTool(name as ToolName, args, target, client.daemonCall, ctx.signal),
			)
			return { text }
		} catch (err) {
			return { text: errorMessage(err), isError: true }
		}
	}

	async function start(): Promise<void> {
		if (disabled) return
		skills = await loadSkills(bundledSkillsDir())
		void pruneClaims(claimsDir())
		await pruneLive()
		await writeLive()
		// The server starts in the plugin's folder, not the session's: look everywhere.
		startSignedIn()
	}

	/**
	 * At exit: every open thread ends its run and sends what is queued, for up to budgetMs. Once:
	 * SessionEnd starts it, and Codex's SIGTERM soon after finds it done or under way.
	 */
	let stopping: Promise<void> | undefined
	const shutdown = (budgetMs = FLUSH_MS): Promise<void> => (stopping ??= stopAll(budgetMs))

	async function stopAll(budgetMs: number): Promise<void> {
		stop.abort()
		// Work for closed threads saves their links as it ends: it must not outlive the server.
		await Promise.race([Promise.all(pending), sleepUnref(budgetMs)])
		clearInterval(controlTimer)
		for (const { beat, inbox, approvals } of channels.values()) {
			clearInterval(beat)
			inbox.close()
			approvals.close()
		}
		channels.clear()
		await Promise.all([...mirrors.values()].flatMap((m) => (m ? [m.shutdown(budgetMs)] : [])))
		await rm(join(liveDir(), `${process.pid}.json`), { force: true })
		log('stopped')
	}

	return { tools, call, start, shutdown, mirrors }
}

async function waitFor(check: () => boolean, ms: number): Promise<void> {
	const end = Date.now() + ms
	while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 50))
}
