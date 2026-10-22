// One Mirror per Codex thread. The first prompt links the thread to a new cloud session
// (automation/run/prepare, which writes that prompt itself). After that the thread's rollout file
// goes up through mapper.ts, read from the offset at the link, and tool calls go up early from the
// PreToolUse hook. The task folder syncs through @humanlayer/session-sdk-artifacts, and the task
// diff through @humanlayer/session-sdk-diffs. Web messages, stops and approval answers come in
// through web(), stop() and answered(). A link is saved by thread id, so a thread Codex resumes
// keeps its cloud session, and the rollout offset the cloud took, so nothing is lost or doubled.
// Handlers only queue work: the outbox and the lanes are the only places that wait on the network.

import { randomUUID } from 'node:crypto'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import {
	ArtifactSync,
	artifactsHint,
	HINT_SECTION,
	type LedgerEntry,
	safeSlug,
	taskFolder,
} from '@humanlayer/session-sdk-artifacts'
import type { Identity } from '@humanlayer/session-sdk-auth'
import {
	type Channel,
	type DaemonRequest,
	errorMessage,
	getChannelConfig,
	Outbox,
	type QueueItem,
	readJsonFile,
	RpcError,
	sleepUnref,
	writeJsonFileAtomic,
} from '@humanlayer/session-sdk-base'
import { DiffSync } from '@humanlayer/session-sdk-diffs'
import {
	type GitInfo,
	gitInfo,
	newTask,
	type PrepareBody,
	type PrepareFacts,
	prepareBody,
	promptText as cutPrompt,
	recordLink,
	repositoriesReport,
	type TaskPick,
} from '@humanlayer/session-sdk-sessions'
import type { ToolTarget } from '@humanlayer/session-sdk-tools'

import { approvalMode, approvalWaitMs, artifactsDir, bindingsDir, client, FLUSH_MS, linksPath, log } from './config.ts'
import { type HookInput, type HookOutput, permission } from './hooks.ts'
import {
	type CloudEvent,
	createMapperState,
	type Mapped,
	mapRecord,
	type MapperState,
	mapToolCall,
	mapToolEnd,
	mapToolResult,
	mapSubagentEnd,
	type RunStatus,
	shapeHookTool,
} from './mapper.ts'
import { RolloutTail } from './rollout.ts'

/** How often the rollout is read between hooks: replies and thinking show without waiting for one. */
const TAIL_MS = 250

/** What a stop tells the model, at the next tool or approval. */
export const STOP_REASON =
	'The user stopped this run from the HumanLayer web app. Do not call any more tools. End your turn now.'

export interface Binding {
	version: 1
	channel: Channel
	threadId: string
	cwd: string
	createdAt: string
	hostId: string
	taskMode: 'ensure' | 'use'
	/** Absent after an attach by uuid: no route reads a task by id. */
	taskSlug?: string
	/** Git facts at link time; the task diff is against headSha. */
	git?: GitInfo
	/** humanlayer-codex off: nothing new goes up until on. */
	off?: boolean
	transcriptPath: string
	/** The rollout offset the cloud has taken everything before. A resume reads from here. */
	acked: number
	/** Prompts the cloud wrote that the rollout has not shown yet: the first, and web messages. */
	skipPrompts: string[]
	// Set when prepare succeeds. A binding with no cloudSessionId is pending and never saved.
	cloudSessionId?: string
	taskId?: string
	userId?: string
	orgId?: string
	sessionUrl?: string
	/** Task files sent so far, by subpath. Written only after the cloud took them. */
	artifactLedger?: Record<string, LedgerEntry>
	/** Task diff rows sent so far, by path. Written only after the streams took them. */
	diffPublished?: Record<string, { patchHash?: string; rowHash: string }>
	/**
	 * A run was going in process pid, with these approvals open in the cloud. A clean exit clears
	 * it; a start that finds it set, with that process gone, follows a crash, and ends the run and
	 * the approvals itself.
	 */
	running?: { pid: number; approvalIds: string[] }
	/** The server process that has this thread open, while it does. */
	owner?: number
	/** The last status sent, so a closed thread's catch-up can say it again. */
	status?: RunStatus
}

/** One thread's mirroring, for status. */
export interface ThreadInfo {
	thread: string
	state: 'linking' | 'mirroring' | 'off' | 'stopped'
	task?: string
	url?: string
	/** Updates waiting to send. */
	queued: number
	/** The last task file synced. */
	synced?: string
	problem?: string
}

/** What a Mirror needs from the server around it. */
export interface MirrorHost {
	/** A notice for the user, shown at the next hook that can show one. */
	notify(threadId: string, message: string): void
	/** The session linked: the host should beat, follow web messages and report skills for its channel. */
	bound(b: Binding): void
	/** Hands a web message to Codex for this thread. */
	deliver(threadId: string, text: string): Promise<void>
}

/** A PermissionRequest hook waiting for the web app's answer. */
interface Approval {
	/** Set once approvals/create answers. */
	approvalId?: string
	toolUseId?: string
	/** The answer, once there is one; the hook waits on it. */
	answer: (a: { approved: boolean; comment?: string }) => void
	/** The hook gave up waiting, so Codex asks in the terminal. Its answer shows in what runs next. */
	terminal?: boolean
	/** Answered, by the web app, the terminal, or a stop. */
	done?: boolean
}

type SessionUpdate = Omit<DaemonRequest<'sessions/update'>, 'sessionId'> & { status?: RunStatus }

type Job =
	| { kind: 'prepare'; body: PrepareBody; fallback?: Omit<PrepareFacts, 'pick'> }
	| { kind: 'approval'; requestID: string; body: Omit<DaemonRequest<'approvals/create'>, 'sessionId'> }
	| { kind: 'resolve'; approvalId: string; decision: 'approve' | 'deny' }
	/** The rollout up to end has gone out: the binding may say so. No network. */
	| { kind: 'ack'; end: number }
	| { kind: 'rpc'; path: 'sessions/update'; body: SessionUpdate }
	| { kind: 'rpc'; path: 'sessions/events/create'; body: CloudEvent }
	| { kind: 'rpc'; path: 'sessions/repositories/report'; body: ReturnType<typeof repositoriesReport> }
type Item = QueueItem & Job

function bindingPath(channel: Channel, threadId: string): string {
	return join(bindingsDir(channel), `${threadId}.json`)
}

/** The saved binding, unless it belongs to another host, or (device login) another user or org. */
async function loadBinding(channel: Channel, threadId: string, who: Identity): Promise<Binding | undefined> {
	const b = await readJsonFile<Binding>(bindingPath(channel, threadId))
	if (b?.version !== 1 || !b.cloudSessionId || b.channel !== channel || b.hostId !== (await client.hostId(channel)))
		return undefined
	if (who.source === 'device' && (b.userId !== who.userId || b.orgId !== who.orgId)) return undefined
	b.skipPrompts ??= []
	return b
}

/** Whether a process is running. Signal 0 checks without sending anything. */
export function alive(pid: number | undefined): boolean {
	if (!pid || pid === process.pid) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/** Task name and sessionName: the prompt's first line cut to 80 characters. */
function sessionTitle(prompt: string): string {
	const line = prompt.split('\n').find((l) => l.trim()) ?? ''
	return Array.from(line.trim()).slice(0, 80).join('').trim() || 'Codex session'
}

export class Mirror {
	private readonly host: MirrorHost
	private readonly binding: Binding
	private readonly state: MapperState
	private outbox: Outbox<Item>
	private readonly abort = new AbortController()
	private readonly tail: RolloutTail
	private tailTimer: NodeJS.Timeout | undefined
	private seq = 0
	private contextWindow: number | undefined
	private lastStatus: RunStatus | undefined
	private halted: string | undefined
	private closing: Promise<void> | undefined
	/** Shutting down: nothing new queues. */
	private sealed = false
	private artifacts: ArtifactSync | undefined
	private diff: DiffSync | undefined
	private synced: string | undefined
	private saveTimer: NodeJS.Timeout | undefined
	/** A web stop waits for the turn to reach a tool, an approval or its end. */
	private stopping = false
	/** PermissionRequest hooks that went to HumanLayer, by request id. */
	private readonly approvals = new Map<string, Approval>()
	/** Subagent threads under this one, by thread id: their rollouts mirror under the Task call that ran them. */
	private readonly children = new Map<string, { toolUseId: string; state: MapperState; tail?: RolloutTail }>()

	private constructor(host: MirrorHost, binding: Binding) {
		this.host = host
		this.binding = binding
		this.state = createMapperState(binding.threadId, binding.cwd)
		this.state.skipPrompts = binding.skipPrompts
		this.lastStatus = binding.status
		this.tail = new RolloutTail(binding.transcriptPath, binding.acked)
		this.outbox = this.newOutbox()
	}

	get threadId(): string {
		return this.binding.threadId
	}

	/** The thread in a cloud session's binding, from the saved bindings: its id and the process that has it open. */
	static async find(channel: Channel, cloudSessionId: string): Promise<Binding | undefined> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (b?.cloudSessionId === cloudSessionId) return b
		}
		return undefined
	}

	/**
	 * The threads (in cwd, if given) no live server has open that left work undone: a run that
	 * ended with its Codex, or rollout the cloud never took. Codex gives a server well under a
	 * second after SIGTERM, so a quit can leave either.
	 */
	static async unfinished(channel: Channel, cwd?: string): Promise<string[]> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		const out: string[] = []
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (!b?.cloudSessionId || (cwd && b.cwd !== cwd) || alive(b.owner) || b.off) continue
			const lost = b.running && !alive(b.running.pid)
			if (lost || (await RolloutTail.size(b.transcriptPath)) > b.acked) out.push(b.threadId)
		}
		return out
	}

	/**
	 * The thread's saved binding, if it has one this login can use. `open`: this process has the
	 * thread, so the mirror follows its rollout; else the mirror only sends what it is given.
	 */
	static async resume(
		host: MirrorHost,
		threadId: string,
		who: Identity,
		o: { open: boolean; transcriptPath?: string | null },
	): Promise<Mirror | undefined> {
		const saved = await loadBinding(who.channel, threadId, who)
		if (!saved) return undefined
		if (o.transcriptPath) saved.transcriptPath = o.transcriptPath
		log(`resuming ${saved.cloudSessionId} for ${threadId}${o.open ? '' : ' (closed)'}`)
		const m = new Mirror(host, saved)
		const lost = saved.running && !alive(saved.running.pid) && !alive(saved.owner) ? saved.running : undefined
		if (o.open) {
			saved.owner = process.pid
			void m.saveNow()
			m.startLanes()
		}
		// What the cloud never took goes first, then a run that ended with its Codex ends here.
		await m.drain()
		if (lost) m.endLostRun(lost.approvalIds)
		if (o.open) m.follow()
		return m
	}

	/** The last run ended with its Codex: its approvals are denied and the run ends interrupted. */
	private endLostRun(approvalIds: string[]): void {
		log(`${this.threadId}: the last run ended with Codex; reporting it interrupted`)
		for (const approvalId of approvalIds) this.push({ kind: 'resolve', approvalId, decision: 'deny' }, 'api', true)
		this.pushStatus('interrupted')
	}

	/**
	 * A new cloud session for this thread, with its first prompt. Queues prepare, the running
	 * status and the repository report; nothing waits on the network here.
	 */
	static async bind(
		host: MirrorHost,
		o: {
			threadId: string
			cwd: string
			who: Identity
			prompt: string
			model?: string
			pick: TaskPick
			transcriptPath: string
		},
	): Promise<Mirror> {
		const channel = o.who.channel
		const [hostId, git, offset] = await Promise.all([
			client.hostId(channel),
			gitInfo(o.cwd),
			RolloutTail.size(o.transcriptPath),
		])
		const binding: Binding = {
			version: 1,
			channel,
			threadId: o.threadId,
			cwd: o.cwd,
			createdAt: new Date().toISOString(),
			hostId,
			taskMode: o.pick.taskMode,
			transcriptPath: o.transcriptPath,
			// History before the link stays local; the prompt itself prepare writes.
			acked: offset,
			skipPrompts: [o.prompt],
			owner: process.pid,
		}
		const slug = o.pick.taskMode === 'ensure' ? o.pick.slug : o.pick.taskSlug
		if (slug) binding.taskSlug = slug
		else if (o.pick.taskMode === 'use') binding.taskId = o.pick.taskIdOrSlug
		if (git) binding.git = git
		const m = new Mirror(host, binding)
		m.state.model = o.model
		const facts = {
			codingAgent: 'codex' as const,
			hostId,
			title: sessionTitle(o.prompt),
			prompt: cutPrompt(o.prompt, 0),
			cwd: o.cwd,
			model: o.model ? { provider: 'openai', id: o.model } : undefined,
			git,
		}
		// The worktree's own task may be gone or not ours: prepare then makes a task instead.
		const fallback = o.pick.taskMode === 'use' && o.pick.auto ? facts : undefined
		m.push({ kind: 'prepare', body: prepareBody({ ...facts, pick: o.pick }), fallback }, 'api', true)
		m.pushStatus('running', { ...m.modelFields(), codingAgentSessionId: o.threadId })
		m.report(git)
		m.follow()
		return m
	}

	/** The system context section that names the task folder, while the session mirrors. */
	hint(): string | undefined {
		if (!this.active) return undefined
		const text = artifactsHint(this.binding.cwd, this.binding.taskSlug)
		return text && `<${HINT_SECTION}>\n${text}\n</${HINT_SECTION}>`
	}

	/** The task the HumanLayer tools act on, or why there is none. */
	toolTarget(): ToolTarget {
		if (this.halted) return { reason: `HumanLayer mirroring stopped: ${this.halted}` }
		if (this.binding.off)
			return { reason: 'HumanLayer mirroring is off for this session. Run `humanlayer-codex on`.' }
		const taskId = this.binding.taskId
		if (!taskId || !this.binding.cloudSessionId)
			return { reason: 'HumanLayer is still linking this session to its task. Try again shortly.', pending: true }
		return { channel: this.binding.channel, taskId }
	}

	get cloudSessionId(): string | undefined {
		return this.binding.cloudSessionId
	}

	get sessionUrl(): string | undefined {
		return this.binding.cloudSessionId ? this.binding.sessionUrl : undefined
	}

	get channel(): Channel {
		return this.binding.channel
	}

	get loginRequired(): boolean {
		return this.outbox.isPaused
	}

	/** What `humanlayer-codex status` shows for this thread. */
	info(): ThreadInfo {
		const b = this.binding
		const info: ThreadInfo = {
			thread: b.threadId,
			state: this.mirrorState(),
			queued: this.outbox.items.filter((i) => i.kind !== 'ack').length,
		}
		const task = b.taskSlug ?? b.taskId
		if (task) info.task = task
		if (this.sessionUrl) info.url = this.sessionUrl
		if (this.synced) info.synced = this.synced
		if (this.halted) info.problem = this.halted
		return info
	}

	private mirrorState(): ThreadInfo['state'] {
		if (this.halted) return 'stopped'
		if (this.binding.off) return 'off'
		return this.binding.cloudSessionId ? 'mirroring' : 'linking'
	}

	private get active(): boolean {
		return !this.halted && !this.binding.off && !this.sealed
	}

	// ---- the rollout ----

	/** Reads the rollout every TAIL_MS, while the thread is open here. */
	private follow(): void {
		if (this.tailTimer) return
		const tick = () => {
			if (this.closing) return
			this.tailTimer = setTimeout(() => void this.drain().finally(tick), TAIL_MS)
			this.tailTimer.unref()
		}
		tick()
	}

	/** Maps everything Codex has written since the last read. Hooks call it first, to keep order. */
	async drain(): Promise<void> {
		if (!this.active) return
		try {
			const records = await this.tail.read()
			for (const record of records) {
				const mapped = mapRecord(record, this.state)
				this.apply(mapped)
				if (mapped.subagent) await this.subagent(mapped.subagent)
			}
			for (const child of this.children.values()) await this.drainChild(child)
			if (records.length > 0) this.push({ kind: 'ack', end: this.tail.position })
		} catch (err) {
			log(`${this.threadId}: rollout: ${errorMessage(err)}`)
		}
	}

	private apply(mapped: Mapped): void {
		for (const event of mapped.events) this.push({ kind: 'rpc', path: 'sessions/events/create', body: event })
		// The API reads a reply or tool event as a running turn. Codex can write one after its turn
		// ended (a command in a background cell finishing): the session still waits for input.
		const idle = this.lastStatus !== undefined && this.lastStatus !== 'running'
		if (idle && mapped.events.length > 0 && !mapped.status) this.pushUpdate({ status: this.lastStatus })
		if (mapped.skipped !== undefined) void this.saveNow()
		if (mapped.contextWindow) this.contextWindow = mapped.contextWindow
		if (mapped.model) this.pushUpdate(this.modelFields())
		if (mapped.usage) this.pushUpdate({ ...mapped.usage, contextWindowLimit: this.contextWindow }, false)
		for (const path of mapped.touched ?? []) this.touched({ path })
		if (mapped.scan) this.touched({})
		if (mapped.status) this.turnStatus(mapped.status, mapped.errorMessage)
	}

	/**
	 * A subagent started: its thread writes its own rollout, beside this one. When it completes, what
	 * is left of that rollout goes up first, then the Task call ends with the subagent's last reply.
	 */
	private async subagent(s: NonNullable<Mapped['subagent']>): Promise<void> {
		if (s.kind === 'started') {
			const state = createMapperState(s.threadId, this.binding.cwd)
			state.parentToolUseId = s.toolUseId
			this.children.set(s.threadId, { toolUseId: s.toolUseId, state })
			return
		}
		const child = this.children.get(s.threadId)
		if (!child) return
		await this.drainChild(child)
		this.apply(mapSubagentEnd(child.toolUseId, child.state, this.state))
		this.children.delete(s.threadId)
	}

	/** A subagent's messages and tools. Its runs, usage and model belong to the parent's turn. */
	private async drainChild(child: { state: MapperState; tail?: RolloutTail }): Promise<void> {
		if (!child.tail) {
			const dir = dirname(this.binding.transcriptPath)
			const name = (await readdir(dir).catch(() => [])).find((f) => f.endsWith(`-${child.state.threadId}.jsonl`))
			if (!name) return
			child.tail = new RolloutTail(join(dir, name), 0)
		}
		for (const record of await child.tail.read()) {
			const mapped = mapRecord(record, child.state)
			for (const event of mapped.events) this.push({ kind: 'rpc', path: 'sessions/events/create', body: event })
			for (const path of mapped.touched ?? []) this.touched({ path })
			if (mapped.scan) this.touched({})
		}
	}

	/** A turn started or ended, as the rollout says. */
	private turnStatus(status: RunStatus, error?: string): void {
		if (status === 'running') {
			if (this.lastStatus !== 'running') this.pushStatus('running')
			return
		}
		// Calls that never got a result end with the turn. An approval does not: Codex can run a
		// command in a background cell, and the turn can end while it waits for its approval.
		this.state.openTools.clear()
		const stopped = this.stopping
		this.stopping = false
		this.touched({})
		this.pushStatus(
			stopped && status === 'ready_for_input' ? 'interrupted' : status,
			error ? { errorMessage: error } : {},
		)
	}

	// ---- hooks ----

	/** PreToolUse. Sends the call; a pending stop denies it. */
	async toolCall(hook: HookInput): Promise<string | undefined> {
		await this.drain()
		if (!this.active) return undefined
		this.apply(mapToolCall(hook, this.state))
		if (!this.stopping) return undefined
		if (hook.tool_use_id) this.apply(mapToolEnd(hook.tool_use_id, STOP_REASON, this.state))
		return STOP_REASON
	}

	/** PostToolUse. Sends the result of a tool with no rollout item; a pending stop replaces the result. */
	async toolResult(hook: HookInput): Promise<string | undefined> {
		await this.drain()
		if (!this.active) return undefined
		this.apply(mapToolResult(hook, this.state))
		for (const a of this.approvals.values()) {
			// The terminal approved what the web app asked about: it ran.
			if (a.terminal && !a.done && a.toolUseId === hook.tool_use_id) this.closeApproval(a, 'approve')
		}
		return this.stopping ? STOP_REASON : undefined
	}

	/**
	 * PermissionRequest. The web app shows the question on the tool's card and the hook waits for
	 * its answer. Codex shows its own prompt only after the hook returns no decision: when the wait
	 * runs out, or in terminal mode.
	 */
	async permission(hook: HookInput, signal: AbortSignal): Promise<HookOutput> {
		await this.drain()
		if (!this.active || !this.binding.cloudSessionId) return {}
		if (this.stopping) return permission('deny', STOP_REASON)
		if (approvalMode() === 'terminal') return {}
		const toolUseId = this.callFor(hook)
		const call = toolUseId ? this.state.tools.get(toolUseId) : undefined
		const [toolName, toolInput] = call
			? [call.name, call.input]
			: shapeHookTool(hook.tool_name ?? 'tool', hook.tool_input, this.binding.cwd)
		const requestID = randomUUID()
		const wait = new AbortController()
		const answer = new Promise<{ approved: boolean; comment?: string } | undefined>((resolve) => {
			const approval: Approval = { answer: resolve }
			if (toolUseId) approval.toolUseId = toolUseId
			this.approvals.set(requestID, approval)
			void sleepUnref(approvalWaitMs(), AbortSignal.any([signal, wait.signal])).then(() => resolve(undefined))
		})
		void answer.then(() => wait.abort())
		const body: Extract<Job, { kind: 'approval' }>['body'] = { toolName, toolInput }
		if (toolUseId) body.toolUseId = toolUseId
		this.push({ kind: 'approval', requestID, body }, 'daemon', true)
		const got = await answer
		const approval = this.approvals.get(requestID)
		if (!got) {
			if (approval && !approval.done) {
				if (signal.aborted) this.closeApproval(approval, 'deny')
				else {
					approval.terminal = true
					this.host.notify(this.threadId, 'No answer in HumanLayer yet: answer here.')
				}
			}
			return {}
		}
		this.approvals.delete(requestID)
		if (!got.approved && toolUseId)
			this.apply(mapToolEnd(toolUseId, got.comment ? `Denied: ${got.comment}` : 'Denied', this.state))
		// The turn ended while this waited: the web app's answer moved the session to running.
		if (this.lastStatus !== 'running') this.pushStatus('ready_for_input')
		return permission(
			got.approved ? 'allow' : 'deny',
			got.approved ? undefined : got.comment || 'Denied in HumanLayer.',
		)
	}

	/** The call a PermissionRequest is about: the latest open call with the same tool and input. */
	private callFor(hook: HookInput): string | undefined {
		const [name, input] = shapeHookTool(hook.tool_name ?? '', hook.tool_input, this.binding.cwd)
		const want = JSON.stringify(input)
		let found: string | undefined
		for (const id of this.state.openTools) {
			const call = this.state.tools.get(id)
			if (call?.name === name && JSON.stringify(call.input) === want) found = id
		}
		return found
	}

	/** Stop: the turn ends. A pending web stop ends it here, without a continuation. */
	async turnEnd(): Promise<HookOutput> {
		await this.drain()
		return this.stopping ? { continue: false, stopReason: 'Stopped from HumanLayer' } : {}
	}

	/** Interrupt: the user stopped the turn in Codex. */
	async interrupted(): Promise<void> {
		await this.drain()
		if (this.lastStatus === 'running') this.turnStatus('interrupted')
	}

	/** PreCompact and PostCompact. */
	compacting(trigger: string | undefined, on: boolean): void {
		if (!this.active) return
		if (on && trigger) this.state.compactTrigger = trigger
		this.pushUpdate({ isCompacting: on })
	}

	// ---- the web app ----

	/** The web app answered an approval. False when it is not one of this thread's. */
	answered(approvalId: string, approved: boolean, comment: string | undefined): boolean {
		for (const approval of this.approvals.values()) {
			if (approval.approvalId !== approvalId) continue
			if (approval.done) return true
			approval.done = true
			log(`web ${approved ? 'approval' : 'denial'} for ${this.binding.cloudSessionId}`)
			const answer: { approved: boolean; comment?: string } = { approved }
			if (comment) answer.comment = comment
			approval.answer(answer)
			this.noteRun()
			return true
		}
		return false
	}

	/** The cloud says running while no turn runs here: it waits for input again. */
	idleAgain(): void {
		if (this.active && this.lastStatus !== 'running') this.pushStatus('ready_for_input')
	}

	/** A web message for this open thread. Reports `running` at once, as riptide-daemon does. */
	web(text: string): void {
		if (!this.active) return
		log(`web message for ${this.binding.cloudSessionId} (${text.length} chars)`)
		this.state.skipPrompts.push(text)
		void this.saveNow()
		this.pushStatus('running')
		this.host.notify(this.threadId, 'Message from the web app')
		void this.host.deliver(this.threadId, text).catch((err) => this.undeliverable(text, err))
	}

	/**
	 * A web message for a thread no Codex has open. Codex keeps it in its queue and runs it when
	 * the thread is resumed; until then the session waits for input.
	 */
	async webClosed(text: string): Promise<void> {
		if (!this.active) return
		log(`web message for closed ${this.binding.cloudSessionId} (${text.length} chars)`)
		this.state.skipPrompts.push(text)
		await this.saveNow()
		try {
			await this.host.deliver(this.threadId, text)
			this.host.notify(
				this.threadId,
				`A web message is queued for Codex session ${this.threadId}. If it is not open, run \`codex resume ${this.threadId}\`.`,
			)
		} catch (err) {
			this.undeliverable(text, err)
		}
		this.pushStatus('ready_for_input')
	}

	private undeliverable(text: string, err: unknown): void {
		log(`web message: ${errorMessage(err)}`)
		const i = this.state.skipPrompts.lastIndexOf(text)
		if (i >= 0) this.state.skipPrompts.splice(i, 1)
		void this.saveNow()
		this.host.notify(this.threadId, `Could not start the web message: ${errorMessage(err)}`)
		this.pushStatus('ready_for_input')
	}

	/**
	 * The web stop button. Codex has no way to interrupt a turn from outside, so a running turn
	 * stops at its next tool call, approval or end: a waiting approval is denied now, the next tool
	 * call is denied, and the Stop hook ends the turn. An idle session reports interrupted now.
	 */
	stop(): void {
		if (!this.active) return
		log(`web interrupt for ${this.binding.cloudSessionId}`)
		if (this.lastStatus !== 'running') {
			this.pushStatus('interrupted')
			return
		}
		this.stopping = true
		this.host.notify(this.threadId, 'Stopped from the web app: the turn ends at its next step.')
		// The web app must not offer them after the stop: each is denied there too.
		for (const approval of this.approvals.values()) {
			if (approval.done) continue
			this.closeApproval(approval, 'deny')
			approval.answer({ approved: false, comment: STOP_REASON })
		}
	}

	/** Answers an approval in the cloud for the user, who answered in Codex, or for a stop. */
	private closeApproval(approval: Approval, decision: 'approve' | 'deny'): void {
		approval.done = true
		if (approval.approvalId) this.push({ kind: 'resolve', approvalId: approval.approvalId, decision }, 'api', true)
		this.noteRun()
	}

	/** humanlayer-codex off: the cloud session waits for input, and nothing new goes up until on. */
	async setOff(off: boolean): Promise<void> {
		const b = this.binding
		if (!!b.off === off && (off || !this.halted)) return
		if (off) {
			this.pushStatus('ready_for_input')
			b.off = true
			this.closeLanes()
		} else {
			// Keep drains disabled until the off-period boundary is known. The prompt hook
			// must wait for this before Codex can append the next turn's records.
			const size = await RolloutTail.size(b.transcriptPath)
			this.tail.skipTo(size)
			b.acked = size
			b.off = false
			if (this.halted || this.outbox.isStopped) {
				this.halted = undefined
				this.outbox = this.newOutbox()
			}
			this.startLanes() // rescans the task folder and rebuilds the diff
		}
		void this.saveNow()
	}

	/** humanlayer-codex attach: the cloud session waits for input, and the binding goes, so the next prompt links anew. */
	async detach(): Promise<void> {
		if (this.binding.cloudSessionId && this.active) this.pushStatus('ready_for_input')
		await this.shutdown()
		await rm(bindingPath(this.binding.channel, this.threadId), { force: true })
	}

	private touched(t: { path?: string }): void {
		this.artifacts?.touched(t)
		this.diff?.touched()
	}

	private modelFields(): SessionUpdate {
		const id = this.state.model
		return { model: id, resolvedModel: id, contextWindowLimit: this.contextWindow }
	}

	private report(git: GitInfo | undefined): void {
		if (git) this.push({ kind: 'rpc', path: 'sessions/repositories/report', body: repositoriesReport(git) })
	}

	/** Session updates stay queued past the cap, except usage, which the next one replaces. */
	private pushUpdate(fields: SessionUpdate, keep = true): void {
		this.push({ kind: 'rpc', path: 'sessions/update', body: fields }, 'daemon', keep)
	}

	private pushStatus(status: RunStatus, extra: SessionUpdate = {}): void {
		this.lastStatus = status
		this.binding.status = status
		this.pushUpdate({ ...extra, status })
		this.noteRun()
		this.saveSoon()
	}

	/**
	 * A closed thread, as its Codex exits: says its last status again. The API reads a late reply
	 * or tool event as a running turn, and no turn runs once Codex is gone.
	 */
	settle(): void {
		if (this.lastStatus && this.lastStatus !== 'running') this.pushUpdate({ status: this.lastStatus })
	}

	/** Saves whether a run is going, and its open approvals, for a start after a crash. */
	private noteRun(): void {
		const b = this.binding
		const approvalIds = [...this.approvals.values()]
			.filter((a) => a.approvalId && !a.done)
			.map((a) => a.approvalId ?? '')
		const running = this.lastStatus === 'running' ? { pid: process.pid, approvalIds } : undefined
		if (JSON.stringify(running) === JSON.stringify(b.running)) return
		b.running = running
		void this.saveNow()
	}

	private push(job: Job, plane: 'api' | 'daemon' = 'daemon', keep = false): void {
		if (this.halted || this.binding.off || this.sealed) return
		const sizeBytes = Buffer.byteLength(JSON.stringify('body' in job ? job.body : job))
		this.outbox.push({ ...job, id: String(++this.seq), plane, sizeBytes, keep: keep || job.kind === 'ack' })
	}

	private newOutbox(): Outbox<Item> {
		return new Outbox<Item>({
			send: (item) => this.send(item),
			log,
			onStopAll: (reason) => this.halt(reason),
			onStopBinding: (reason) => this.halt(reason),
			onSkip: (item, err) => {
				if (item.kind === 'prepare') this.halt(`could not start the cloud session: ${errorMessage(err)}`)
			},
			onDrop: (item) => log(`queue full: dropped ${item.kind === 'rpc' ? item.path : item.kind}`),
		})
	}

	private async send(item: Item): Promise<void> {
		const b = this.binding
		if (item.kind === 'prepare') return this.sendPrepare(item)
		if (item.kind === 'ack') {
			if (item.end > b.acked) {
				b.acked = item.end
				this.saveSoon()
			}
			return
		}
		if (!b.cloudSessionId) return
		if (item.kind === 'approval') return this.sendApproval(b.cloudSessionId, item)
		if (item.kind === 'resolve') {
			const body = { approvalId: item.approvalId, decision: item.decision }
			await client.apiRpc(b.channel, 'approvals/resolve', body, this.abort.signal)
			return
		}
		const body = { ...item.body, sessionId: b.cloudSessionId }
		const signal = this.abort.signal
		await client.withDaemonToken(b.channel, signal, (token) =>
			client.rpc(b.channel, 'daemon', item.path, body, token, signal),
		)
	}

	private async sendApproval(sessionId: string, item: Extract<Item, { kind: 'approval' }>): Promise<void> {
		const approval = this.approvals.get(item.requestID)
		if (!approval) return
		const out = await client.daemonCall(
			this.binding.channel,
			'approvals/create',
			{ ...item.body, sessionId },
			this.abort.signal,
		)
		approval.approvalId = out.approvalId
		// Answered (a stop) while the approval was on its way: the web app must not offer it.
		if (approval.done) this.push({ kind: 'resolve', approvalId: out.approvalId, decision: 'deny' }, 'api', true)
		this.noteRun()
	}

	private async sendPrepare(item: Extract<Item, { kind: 'prepare' }>): Promise<void> {
		const b = this.binding
		const signal = this.abort.signal
		// Read before prepare, so a login this needs fails before a session exists.
		const org = await client.daemonOrgId(b.channel, signal)
		let out: Awaited<ReturnType<typeof client.prepare>>
		try {
			out = await client.prepare(b.channel, item.body, signal)
		} catch (err) {
			if (!(err instanceof RpcError) || (err.status !== 403 && err.status !== 404)) throw err
			const task = b.taskSlug ?? b.taskId
			if (item.fallback) {
				log(`task link ${task} failed (${err.status}); creating a task`)
				const pick = newTask('codex', b.threadId)
				item.body = prepareBody({ ...item.fallback, pick })
				item.fallback = undefined
				b.taskMode = 'ensure'
				b.taskSlug = pick.slug
				b.taskId = undefined
				return this.sendPrepare(item)
			}
			if (err.status === 404)
				return this.halt(
					`task ${task} not found. Use \`humanlayer-codex attach <task>\` or \`humanlayer-codex attach new\`.`,
				)
			return this.halt(`no access to task ${task}`)
		}
		const who = await client.identity(b.channel)
		b.cloudSessionId = out.sessionId
		b.taskId = out.taskId
		b.userId = out.userId
		b.orgId = org ?? who?.orgId
		b.sessionUrl = `${getChannelConfig(b.channel).app}/sessions/${out.sessionId}`
		await this.saveNow()
		log(`bound ${b.threadId} to ${b.cloudSessionId}`)
		this.host.notify(this.threadId, `HumanLayer: mirroring to ${b.sessionUrl}`)
		this.startLanes()
	}

	/** Starts the task folder sync and the diff, once the session is linked. */
	private startLanes(): void {
		const b = this.binding
		if (!b.taskId || !b.cloudSessionId || !this.active) return
		this.host.bound(b)
		this.startArtifacts(b.taskId, b.cloudSessionId)
		this.startDiff(b.taskId, b.cloudSessionId)
	}

	private startArtifacts(taskId: string, sessionId: string): void {
		const b = this.binding
		const slug = safeSlug(b.taskSlug)
		if (this.artifacts || !slug) return
		this.artifacts = new ArtifactSync(
			{
				channel: b.channel,
				taskId,
				sessionId,
				cwd: b.cwd,
				store: artifactsDir(taskId),
				signal: this.abort.signal,
				ledger: () => (b.artifactLedger ??= {}),
				save: () => this.saveSoon(),
				note: (file) => {
					log(`synced task file ${file}`)
					this.synced = basename(file)
				},
				warn: (_key, message) => this.host.notify(this.threadId, message),
				log,
				daemonCall: client.daemonCall,
				recordLink: (path, id) => recordLink(linksPath(), path, id),
			},
			taskFolder(b.cwd, slug),
		)
	}

	/**
	 * The diff of a task this session made, in a repo with a commit. A task it only joined belongs
	 * to the daemon of that task's worktree, which sends its diff.
	 */
	private startDiff(taskId: string, sessionId: string): void {
		const b = this.binding
		if (this.diff || b.taskMode !== 'ensure' || !b.git?.headSha || !b.orgId) return
		const signal = this.abort.signal
		this.diff = new DiffSync(
			{
				syncUrl: getChannelConfig(b.channel).sync,
				orgId: b.orgId,
				taskId,
				sessionId,
				gitRoot: b.git.root,
				baseSha: b.git.headSha,
				repoId: basename(b.git.root),
				published: b.diffPublished ?? {},
			},
			{
				daemonToken: () => client.daemonToken(b.channel, signal),
				remintDaemonToken: () => client.remintDaemonToken(b.channel, signal),
				onPublished: (published) => {
					b.diffPublished = published
					this.saveSoon()
				},
				onError: (kind, message) => {
					if (kind !== 'transient') this.host.notify(this.threadId, `Task diff ${kind}: ${message}`)
				},
				log,
			},
		)
		this.diff.touched() // the tree may have changed since the last publish
	}

	private closeLanes(): void {
		this.artifacts?.close()
		this.diff?.close()
		this.artifacts = undefined
		this.diff = undefined
	}

	private saveSoon(): void {
		if (this.saveTimer) return
		this.saveTimer = setTimeout(() => void this.saveNow(), 2000)
		this.saveTimer.unref()
	}

	private async saveNow(): Promise<void> {
		clearTimeout(this.saveTimer)
		this.saveTimer = undefined
		const b = this.binding
		if (!b.cloudSessionId) return
		await writeJsonFileAtomic(bindingPath(b.channel, b.threadId), b).catch((err) =>
			log(`save: ${errorMessage(err)}`),
		)
	}

	private halt(reason: string): void {
		if (this.halted) return
		this.halted = reason
		log(`stopped ${this.threadId}: ${reason}`)
		this.closeLanes()
		this.host.notify(this.threadId, `HumanLayer: mirroring stopped: ${reason}`)
	}

	/**
	 * At exit: what the rollout still holds goes up, a run still going ends as interrupted, open
	 * approvals are denied, then what is queued goes out, for up to budgetMs. The link is saved
	 * first: Codex may kill the server at any moment after SIGTERM. Until the interrupted status
	 * is sent, the link keeps the run, so the next start ends it if this one could not.
	 */
	shutdown(budgetMs = FLUSH_MS): Promise<void> {
		this.closing ??= this.close(budgetMs)
		return this.closing
	}

	private async close(budgetMs: number): Promise<void> {
		clearTimeout(this.tailTimer)
		const b = this.binding
		let unsentRun: Binding['running']
		if (b.owner === process.pid) {
			await this.drain()
			for (const approval of this.approvals.values()) {
				if (!approval.done) this.closeApproval(approval, 'deny')
				approval.answer({ approved: false })
			}
			if (this.lastStatus === 'running') {
				unsentRun = b.running ?? { pid: process.pid, approvalIds: [] }
				this.pushStatus('interrupted')
			}
			b.owner = undefined
		}
		this.sealed = true
		const unsent = () => this.outbox.items.filter((i) => i.kind !== 'ack').length
		b.running = unsentRun
		await this.saveNow()
		await Promise.all([this.outbox.drain(budgetMs), this.artifacts?.flush(budgetMs), this.diff?.flush(budgetMs)])
		if (unsent() === 0) b.running = undefined
		await this.saveNow()
		if (unsent() > 0) log(`${this.threadId}: ${unsent()} updates not sent; the next Codex start sends them`)
		this.outbox.close()
		this.closeLanes()
		this.abort.abort()
	}
}
