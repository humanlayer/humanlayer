// One Mirror per opencode session. The first prompt binds the session to a new cloud session
// (automation/run/prepare, which writes that prompt itself); after that, prompts and session
// events go through mapper.ts into the outbox, opencode's runs become the cloud status, the task
// folder syncs through @humanlayer/session-sdk-artifacts, and the task diff through
// @humanlayer/session-sdk-diffs. Web replies and stops come in through web() and stop(). A binding
// is saved by opencode session id, so a session opencode continues keeps its cloud session.
// Handlers only queue work: the outboxes and the lanes are the only places that wait on the network.

import { readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'

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
import type { OpenCodeEvent } from '@opencode/client/promise'

import { artifactsDir, bindingsDir, client, FLUSH_MS, linksPath, log } from './config.ts'
import {
	type CloudEvent,
	createMapperState,
	type Mapped,
	mapEvent,
	type MapperState,
	mapPrompt,
	shapeToolCall,
	subagentSession,
} from './mapper.ts'
import type { SessionInfo } from './rpc.ts'

/** How long a finished run waits for its open tool calls before it reports how it ended. */
const SETTLE_MS = 2000

export interface Binding {
	version: 1
	channel: Channel
	opencodeSessionId: string
	cwd: string
	createdAt: string
	hostId: string
	taskMode: 'ensure' | 'use'
	/** Absent after an attach by uuid: no route reads a task by id. */
	taskSlug?: string
	/** Git facts at bind time; the task diff is against headSha. */
	git?: GitInfo
	/** /humanlayer off: nothing new goes up until on. */
	off?: boolean
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
	 * it; a resume that finds it set, with that process gone, follows a crash, and ends the run and
	 * the approvals itself.
	 */
	running?: { pid: number; approvalIds: string[] }
}

export interface Model {
	providerID: string
	id: string
}

/** What a Mirror needs from the plugin around it. */
export interface MirrorHost {
	notify(sessionID: string, message: string, variant: 'info' | 'warning' | 'error'): void
	/** The session's status changed: the footer should ask again. */
	changed(sessionID: string): void
	/** The model's context window, when opencode knows it. */
	contextLimit(model: Model): Promise<number | undefined>
	/** The session bound: the host should beat, follow web messages and report skills for its channel. */
	bound(b: Binding): void
	/** Hands a web message to opencode for this session. */
	deliver(sessionID: string, text: string): Promise<void>
	/** Stops the session's run. */
	interrupt(sessionID: string): Promise<void>
	/** Answers one of opencode's permission requests. */
	reply(sessionID: string, requestID: string, approved: boolean, message: string | undefined): Promise<void>
}

/** One of opencode's permission requests, as HumanLayer's approval of it. */
interface Approval {
	/** Set once approvals/create answers. */
	approvalId?: string
	/** Who answered first: the web app (through the approvals shape), or opencode's own prompt. */
	answeredBy?: 'web' | 'opencode'
	/** An answer in opencode before the approval existed in the cloud: sent once it does. */
	decision?: 'approve' | 'deny'
	/** The opencode session that asked: this one, or one of its subagents'. */
	sessionID: string
}

type Permission = Extract<OpenCodeEvent, { type: 'permission.asked' }>['data']

type SessionStatus = Extract<
	NonNullable<DaemonRequest<'sessions/update'>['status']>,
	'running' | 'ready_for_input' | 'interrupted' | 'failed'
>
type SessionUpdate = Omit<DaemonRequest<'sessions/update'>, 'sessionId'> & { status?: SessionStatus }

type Job =
	| { kind: 'prepare'; body: PrepareBody; fallback?: Omit<PrepareFacts, 'pick'> }
	| { kind: 'approval'; requestID: string; body: Omit<DaemonRequest<'approvals/create'>, 'sessionId'> }
	| { kind: 'resolve'; requestID: string; decision: 'approve' | 'deny' }
	| { kind: 'rename'; title: string }
	| { kind: 'rpc'; path: 'sessions/update'; body: SessionUpdate }
	| { kind: 'rpc'; path: 'sessions/events/create'; body: CloudEvent }
	| { kind: 'rpc'; path: 'sessions/repositories/report'; body: ReturnType<typeof repositoriesReport> }
type Item = QueueItem & Job

function bindingPath(channel: Channel, sessionId: string): string {
	return join(bindingsDir(channel), `${sessionId}.json`)
}

/** The saved binding, unless it belongs to another host, or (device login) another user or org. */
async function loadBinding(channel: Channel, sessionId: string, who: Identity): Promise<Binding | undefined> {
	const b = await readJsonFile<Binding>(bindingPath(channel, sessionId))
	if (b?.version !== 1 || !b.cloudSessionId || b.channel !== channel || b.hostId !== (await client.hostId(channel)))
		return undefined
	if (who.source === 'device' && (b.userId !== who.userId || b.orgId !== who.orgId)) return undefined
	b.taskMode ??= 'ensure' // bindings from before taskMode were all new tasks
	return b
}

/** Whether a process is running. Signal 0 checks without sending anything. */
function alive(pid: number): boolean {
	if (pid === process.pid) return false
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
	return Array.from(line.trim()).slice(0, 80).join('').trim() || 'opencode session'
}

export class Mirror {
	private readonly host: MirrorHost
	private readonly binding: Binding
	private readonly state: MapperState
	private outbox: Outbox<Item>
	private readonly abort = new AbortController()
	private seq = 0
	private model: Model | undefined
	private contextWindow: number | undefined
	private lastStatus: SessionStatus | undefined
	private halted: string | undefined
	private closing: Promise<void> | undefined
	private artifacts: ArtifactSync | undefined
	private diff: DiffSync | undefined
	private synced: string | undefined
	private saveTimer: NodeJS.Timeout | undefined
	/** opencode's permission requests that went to HumanLayer, by request id. */
	private readonly approvals = new Map<string, Approval>()
	/** Subagent sessions under this one, by opencode session id, with the tool call that ran each. */
	private readonly children = new Map<string, MapperState>()
	/** Events of subagent sessions opencode has not yet named in a tool call. */
	private readonly early = new Map<string, OpenCodeEvent[]>()
	/** The status a finished run reports once its open tool calls end, or SETTLE_MS passes. */
	private settling: { status: SessionStatus; extra: SessionUpdate; timer: NodeJS.Timeout } | undefined

	private constructor(host: MirrorHost, binding: Binding, model: Model | undefined) {
		this.host = host
		this.binding = binding
		this.model = model
		this.state = createMapperState(binding.opencodeSessionId, binding.cwd)
		this.state.model = model?.id
		this.outbox = this.newOutbox()
	}

	private get id(): string {
		return this.binding.opencodeSessionId
	}

	/** The opencode session in cwd that mirrors to this cloud session, from the saved bindings. */
	static async find(channel: Channel, cloudSessionId: string, cwd: string): Promise<string | undefined> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (b?.cloudSessionId === cloudSessionId && b.cwd === cwd) return b.opencodeSessionId
		}
		return undefined
	}

	/** The opencode sessions in cwd whose last run ended in a crash, from the saved bindings. */
	static async lostRuns(channel: Channel, cwd: string): Promise<string[]> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		const lost: string[] = []
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (b?.cwd === cwd && b.running && !alive(b.running.pid)) lost.push(b.opencodeSessionId)
		}
		return lost
	}

	/** The session's saved binding, if it has one this login can use. Local files only. */
	static async resume(
		host: MirrorHost,
		sessionId: string,
		who: Identity,
		model: Model | undefined,
	): Promise<Mirror | undefined> {
		const saved = await loadBinding(who.channel, sessionId, who)
		if (!saved) return undefined
		log(`resuming ${saved.cloudSessionId} for ${sessionId}`)
		const m = new Mirror(host, saved, model)
		await m.modelChanged(model)
		m.startLanes()
		if (saved.running && !alive(saved.running.pid)) m.endLostRun(saved.running.approvalIds)
		return m
	}

	/** The last opencode process ended mid-run without a clean exit: its run and approvals are gone. */
	private endLostRun(approvalIds: string[]): void {
		log(`${this.id}: the last run ended with opencode; reporting it interrupted`)
		for (const approvalId of approvalIds) {
			const requestID = `lost-${approvalId}`
			this.approvals.set(requestID, { approvalId, sessionID: this.id, answeredBy: 'opencode' })
			this.push({ kind: 'resolve', requestID, decision: 'deny' }, 'api', true)
		}
		this.pushStatus('interrupted')
	}

	/**
	 * A new cloud session for this opencode session, with its first prompt. Queues prepare, the
	 * running status and the repository report; nothing waits on the network here.
	 */
	static async bind(
		host: MirrorHost,
		o: { sessionId: string; cwd: string; who: Identity; prompt: string; model?: Model; pick: TaskPick },
	): Promise<Mirror> {
		const channel = o.who.channel
		const [hostId, git] = await Promise.all([client.hostId(channel), gitInfo(o.cwd)])
		const binding: Binding = {
			version: 1,
			channel,
			opencodeSessionId: o.sessionId,
			cwd: o.cwd,
			createdAt: new Date().toISOString(),
			hostId,
			taskMode: o.pick.taskMode,
		}
		const slug = o.pick.taskMode === 'ensure' ? o.pick.slug : o.pick.taskSlug
		if (slug) binding.taskSlug = slug
		else if (o.pick.taskMode === 'use') binding.taskId = o.pick.taskIdOrSlug
		if (git) binding.git = git
		const m = new Mirror(host, binding, o.model)
		if (o.model) m.contextWindow = await host.contextLimit(o.model)
		const facts = {
			codingAgent: 'opencode' as const,
			hostId,
			title: sessionTitle(o.prompt),
			prompt: cutPrompt(o.prompt, 0),
			cwd: o.cwd,
			model: o.model && { provider: o.model.providerID, id: o.model.id },
			git,
		}
		// The worktree's own task may be gone or not ours: prepare then makes a task instead.
		const fallback = o.pick.taskMode === 'use' && o.pick.auto ? facts : undefined
		m.push({ kind: 'prepare', body: prepareBody({ ...facts, pick: o.pick }), fallback }, 'api', true)
		m.pushStatus('running', { ...m.modelFields(), codingAgentSessionId: o.sessionId })
		m.report(git)
		m.changed()
		return m
	}

	/** Every prompt after the first, unless the cloud wrote it itself (a web message). */
	prompt(messageID: string, content: string): void {
		this.queue(mapPrompt(messageID, content, this.state))
	}

	/** The system prompt section that names the task folder, while the session mirrors. */
	hint(): string | undefined {
		if (!this.active) return undefined
		const text = artifactsHint(this.binding.cwd, this.binding.taskSlug, this.binding.sessionUrl)
		return text && `<${HINT_SECTION}>\n${text}\n</${HINT_SECTION}>`
	}

	/** The task the HumanLayer tools act on, or why there is none. */
	toolTarget(): ToolTarget {
		if (this.halted) return { reason: `HumanLayer mirroring stopped: ${this.halted}` }
		if (this.binding.off) return { reason: 'HumanLayer mirroring is off for this session. Run /humanlayer on.' }
		const taskId = this.binding.taskId
		if (!taskId || !this.binding.cloudSessionId)
			return { reason: 'HumanLayer is still linking this session to its task. Try again shortly.', pending: true }
		return { channel: this.binding.channel, taskId }
	}

	/** The cloud session this mirrors to, once bound. */
	get cloudSessionId(): string | undefined {
		return this.binding.cloudSessionId
	}

	get channel(): Channel {
		return this.binding.channel
	}

	/** Whether the outbox waits for a new login. */
	get loginRequired(): boolean {
		return this.outbox.isPaused
	}

	/** What the footer and /humanlayer status show. */
	info(): SessionInfo {
		const b = this.binding
		const info: SessionInfo = { state: this.mirrorState(), queued: this.outbox.length }
		const task = b.taskSlug ?? b.taskId?.slice(0, 8)
		if (task) info.task = task
		if (b.sessionUrl && b.cloudSessionId) info.url = b.sessionUrl
		if (this.synced) info.synced = this.synced
		if (this.halted) info.problem = this.halted
		return info
	}

	private mirrorState(): SessionInfo['state'] {
		if (this.halted) return 'stopped'
		if (this.binding.off) return 'off'
		return this.binding.cloudSessionId ? 'mirroring' : 'binding'
	}

	private get active(): boolean {
		return !this.halted && !this.binding.off && !this.closing
	}

	event(event: OpenCodeEvent): void {
		switch (event.type) {
			case 'session.execution.started':
				this.cancelSettle()
				if (this.lastStatus !== 'running') this.pushStatus('running')
				return
			case 'session.execution.succeeded':
				return this.settle('ready_for_input')
			case 'session.execution.failed':
				return this.settle('failed', { errorMessage: event.data.error.message })
			case 'session.execution.interrupted':
				return this.settle('interrupted')
			case 'permission.asked':
				return this.asked(event.data)
			case 'permission.replied':
				return this.replied(event.data.requestID, event.data.reply !== 'reject')
			case 'session.renamed':
				return this.renamed(event.data.title)
			case 'session.model.selected':
				void this.modelChanged(event.data.model).catch((err) => log(`model: ${errorMessage(err)}`))
				return
			case 'session.compaction.started':
				this.pushUpdate({ isCompacting: true })
				break
			case 'session.compaction.ended':
			case 'session.compaction.failed':
				this.pushUpdate({ isCompacting: false })
				break
		}
		this.map(event, this.state)
		if (this.settling && this.state.openTools.size === 0) this.finishSettle()
	}

	/**
	 * An event of a subagent session under this one, at any depth. Its messages and tool calls
	 * mirror into this cloud session, grouped under the tool call that ran it; its runs and usage
	 * belong to the parent's run. Events from before opencode names the subagent's session wait.
	 */
	childEvent(sessionID: string, event: OpenCodeEvent): void {
		const state = this.children.get(sessionID)
		if (!state) {
			const early = this.early.get(sessionID) ?? []
			if (early.length < 500) early.push(event)
			this.early.set(sessionID, early)
			return
		}
		switch (event.type) {
			case 'permission.asked':
				return this.asked(event.data, state)
			case 'permission.replied':
				return this.replied(event.data.requestID, event.data.reply !== 'reject')
			case 'session.step.ended':
				return this.map(event, state, false)
		}
		if (event.type.startsWith('session.') && !event.type.startsWith('session.execution.')) this.map(event, state)
	}

	/** Maps one event of this session or a subagent's, and links the subagent sessions it starts. */
	private map(event: OpenCodeEvent, state: MapperState, usage = true): void {
		const mapped = mapEvent(event, state)
		if (!usage) delete mapped.usage
		this.queue(mapped)
		for (const path of mapped.touched ?? []) this.touched({ path })
		if (mapped.scan) this.touched({})
		const child = subagentSession(state, event)
		if (child && !this.children.has(child.sessionId)) {
			const childState = createMapperState(child.sessionId, this.binding.cwd)
			childState.parentToolUseId = child.toolCallId
			this.children.set(child.sessionId, childState)
			const early = this.early.get(child.sessionId) ?? []
			this.early.delete(child.sessionId)
			for (const e of early) this.childEvent(child.sessionId, e)
		}
	}

	/**
	 * opencode asks before a tool runs: the web app shows the same question as an approval, on the
	 * tool call it belongs to. Either side may answer; the other then hears of it.
	 */
	private asked(p: Permission, state = this.state): void {
		if (!this.active || !this.binding.cloudSessionId || this.approvals.has(p.id)) return
		const toolUseId = p.source?.type === 'tool' ? p.source.id : undefined
		const call = toolUseId ? state.tools.get(toolUseId) : undefined
		const toolName = call ? shapeToolCall(call.name, {}, this.binding.cwd)[0] : p.action
		const toolInput = call?.input ?? { resources: p.resources, ...p.metadata }
		this.approvals.set(p.id, { sessionID: p.sessionID })
		const body: Extract<Job, { kind: 'approval' }>['body'] = { toolName, toolInput }
		if (toolUseId) body.toolUseId = toolUseId
		this.push({ kind: 'approval', requestID: p.id, body }, 'daemon', true)
	}

	/** opencode named the session (its own title, or the user's): the web app shows the same name. */
	private renamed(title: string): void {
		const name = title.trim()
		if (name) this.push({ kind: 'rename', title: name }, 'api')
	}

	/** opencode's own prompt answered: the web app's approval gets the same answer. */
	private replied(requestID: string, approved: boolean): void {
		const approval = this.approvals.get(requestID)
		if (!approval || approval.answeredBy) return
		approval.answeredBy = 'opencode'
		const decision = approved ? 'approve' : 'deny'
		if (approval.approvalId) this.push({ kind: 'resolve', requestID, decision }, 'api', true)
		else approval.decision = decision
	}

	/** The web app answered an approval. False when it is not one of this session's. */
	answered(approvalId: string, approved: boolean, comment: string | undefined): boolean {
		for (const [requestID, approval] of this.approvals) {
			if (approval.approvalId !== approvalId) continue
			if (approval.answeredBy) return true
			approval.answeredBy = 'web'
			log(`web ${approved ? 'approval' : 'denial'} for ${this.binding.cloudSessionId}`)
			void this.host.reply(approval.sessionID, requestID, approved, comment).catch((err) => {
				log(`permission reply: ${errorMessage(err)}`)
			})
			return true
		}
		return false
	}

	/** A web reply. Reports `running` at once, as riptide-daemon does, so the web app stops showing it as waiting. */
	web(text: string): void {
		if (!this.active) return
		log(`web message for ${this.binding.cloudSessionId} (${text.length} chars)`)
		this.pushStatus('running')
		this.host.notify(this.id, 'Message from the web app', 'info')
		void this.host.deliver(this.id, text).catch((err) => {
			log(`web message: ${errorMessage(err)}`)
			this.host.notify(this.id, `Could not start the web message: ${errorMessage(err)}`, 'error')
			this.pushStatus('ready_for_input')
		})
	}

	/**
	 * The web stop button. A running turn ends as interrupted; an idle one reports it now. Open
	 * permission requests are rejected first: an interrupt drops them in opencode's server, but its
	 * TUI would keep showing the prompt. The stop denies their approvals in the cloud.
	 */
	stop(): void {
		if (!this.active) return
		log(`web interrupt for ${this.binding.cloudSessionId}`)
		if (this.lastStatus === 'running' && !this.settling) {
			void (async () => {
				for (const [requestID, approval] of this.approvals) {
					if (approval.answeredBy) continue
					approval.answeredBy = 'web'
					// Not in the cloud yet, so the web app could not deny it: it is denied once it lands.
					if (!approval.approvalId) approval.decision = 'deny'
					await this.host.reply(approval.sessionID, requestID, false, undefined).catch((err) => {
						log(`permission reply: ${errorMessage(err)}`)
					})
				}
				await this.host.interrupt(this.id)
			})().catch((err) => {
				log(`web interrupt: ${errorMessage(err)}`)
				this.pushStatus('interrupted')
			})
		} else {
			this.cancelSettle()
			this.pushStatus('interrupted')
		}
	}

	/** /humanlayer off: the cloud session waits for input, and nothing new goes up until on. */
	setOff(off: boolean): void {
		const b = this.binding
		if (!!b.off === off && (off || !this.halted)) return
		if (off) {
			this.pushStatus('ready_for_input')
			b.off = true
			this.closeLanes()
		} else {
			b.off = false
			if (this.halted || this.outbox.isStopped) {
				this.halted = undefined
				this.outbox = this.newOutbox()
			}
			this.startLanes() // rescans the task folder and rebuilds the diff
		}
		void this.saveNow()
		this.changed()
	}

	/** /humanlayer attach: the cloud session waits for input, and the binding goes, so the next prompt binds anew. */
	async detach(): Promise<void> {
		if (this.binding.cloudSessionId && this.active) this.pushStatus('ready_for_input')
		await this.shutdown()
		await rm(bindingPath(this.binding.channel, this.id), { force: true })
	}

	private touched(t: { path?: string }): void {
		this.artifacts?.touched(t)
		this.diff?.touched()
	}

	/** A run ended. The status waits for open tool calls: a tool result after it would read as running again. */
	private settle(status: SessionStatus, extra: SessionUpdate = {}): void {
		this.cancelSettle()
		this.touched({})
		const timer = setTimeout(() => this.finishSettle(), SETTLE_MS)
		timer.unref()
		this.settling = { status, extra, timer }
		if (this.state.openTools.size === 0) this.finishSettle()
	}

	private finishSettle(): void {
		const s = this.settling
		if (!s) return
		this.cancelSettle()
		this.state.openTools.clear() // calls that never got a result
		this.pushStatus(s.status, s.extra)
	}

	private cancelSettle(): void {
		if (this.settling) clearTimeout(this.settling.timer)
		this.settling = undefined
	}

	private async modelChanged(model: Model | undefined): Promise<void> {
		if (!model || (this.model?.id === model.id && this.model.providerID === model.providerID && this.contextWindow))
			return
		this.model = model
		this.state.model = model.id
		this.contextWindow = await this.host.contextLimit(model)
		this.pushUpdate(this.modelFields())
	}

	private modelFields(): SessionUpdate {
		const id = this.model?.id
		return { model: id, resolvedModel: id, contextWindowLimit: this.contextWindow }
	}

	private report(git: GitInfo | undefined): void {
		if (git) this.push({ kind: 'rpc', path: 'sessions/repositories/report', body: repositoriesReport(git) })
	}

	private queue(mapped: Mapped): void {
		for (const event of mapped.events) this.push({ kind: 'rpc', path: 'sessions/events/create', body: event })
		if (mapped.usage) this.pushUpdate({ ...mapped.usage, contextWindowLimit: this.contextWindow }, false)
	}

	/** Session updates stay queued past the cap, except usage, which the next one replaces. */
	private pushUpdate(fields: SessionUpdate, keep = true): void {
		this.push({ kind: 'rpc', path: 'sessions/update', body: fields }, 'daemon', keep)
	}

	private pushStatus(status: SessionStatus, extra: SessionUpdate = {}): void {
		this.lastStatus = status
		this.pushUpdate({ ...extra, status })
		this.noteRun()
	}

	/** Saves whether a run is going, and its open approvals, for a resume after a crash. */
	private noteRun(): void {
		const b = this.binding
		const approvalIds = [...this.approvals.values()]
			.filter((a) => a.approvalId && !a.answeredBy)
			.map((a) => a.approvalId ?? '')
		const running = this.lastStatus === 'running' ? { pid: process.pid, approvalIds } : undefined
		if (JSON.stringify(running) === JSON.stringify(b.running)) return
		b.running = running
		void this.saveNow()
	}

	private push(job: Job, plane: 'api' | 'daemon' = 'daemon', keep = false): void {
		if (this.halted || this.binding.off || this.closing) return
		const sizeBytes = Buffer.byteLength(JSON.stringify('body' in job ? job.body : job))
		this.outbox.push({ ...job, id: String(++this.seq), plane, sizeBytes, keep })
		this.changed()
	}

	private newOutbox(): Outbox<Item> {
		return new Outbox<Item>({
			send: (item) => this.send(item).finally(() => this.changed()),
			log,
			onPause: () => this.changed(),
			onResume: () => this.changed(),
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
		if (!b.cloudSessionId) return
		if (item.kind === 'approval') return this.sendApproval(b.cloudSessionId, item)
		if (item.kind === 'resolve') return this.sendResolve(item)
		if (item.kind === 'rename') return this.sendRename(b.cloudSessionId, item.title)
		const body = { ...item.body, sessionId: b.cloudSessionId }
		const signal = this.abort.signal
		await client.withDaemonToken(b.channel, signal, (token) =>
			client.rpc(b.channel, 'daemon', item.path, body, token, signal),
		)
	}

	private async sendApproval(sessionId: string, item: Extract<Item, { kind: 'approval' }>): Promise<void> {
		const approval = this.approvals.get(item.requestID)
		if (!approval) return
		if (!approval.approvalId) {
			const out = await client.daemonCall(
				this.binding.channel,
				'approvals/create',
				{ ...item.body, sessionId },
				this.abort.signal,
			)
			approval.approvalId = out.approvalId
		}
		// opencode's prompt answered while the approval was on its way.
		if (approval.decision) {
			const resolve = { kind: 'resolve' as const, requestID: item.requestID, decision: approval.decision }
			// Shutdown has closed the queue to new jobs, so finish this answer in the current job.
			if (this.closing) await this.sendResolve({ ...item, ...resolve })
			else this.push(resolve, 'api', true)
		}
		this.noteRun()
	}

	/** Renames the session, and the task too when this session made it: its name came from the first prompt. */
	private async sendRename(sessionId: string, title: string): Promise<void> {
		const b = this.binding
		const signal = this.abort.signal
		await client.apiRpc(b.channel, 'sessions/update', { sessionId, title }, signal)
		if (b.taskMode === 'ensure' && b.taskId)
			await client.apiRpc(b.channel, 'tasks/update', { taskId: b.taskId, name: title }, signal)
	}

	/** Answers the web app's approval as the user, who answered in opencode. */
	private async sendResolve(item: Extract<Item, { kind: 'resolve' }>): Promise<void> {
		const approvalId = this.approvals.get(item.requestID)?.approvalId
		if (!approvalId) return
		const body = { approvalId, decision: item.decision }
		await client.apiRpc(this.binding.channel, 'approvals/resolve', body, this.abort.signal)
		this.approvals.delete(item.requestID)
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
				const pick = newTask('opencode', b.opencodeSessionId)
				item.body = prepareBody({ ...item.fallback, pick })
				item.fallback = undefined
				b.taskMode = 'ensure'
				b.taskSlug = pick.slug
				b.taskId = undefined
				return this.sendPrepare(item)
			}
			if (err.status === 404)
				return this.halt(`task ${task} not found. Use /humanlayer attach <task> or /humanlayer attach new.`)
			return this.halt(`no access to task ${task}`)
		}
		const who = await client.identity(b.channel)
		b.cloudSessionId = out.sessionId
		b.taskId = out.taskId
		b.userId = out.userId
		b.orgId = org ?? who?.orgId
		b.sessionUrl = `${getChannelConfig(b.channel).app}/sessions/${out.sessionId}`
		await this.saveNow()
		log(`bound ${b.opencodeSessionId} to ${b.cloudSessionId}`)
		this.host.notify(this.id, `Mirroring to ${b.sessionUrl}`, 'info')
		this.startLanes()
		this.changed()
	}

	/** Starts the task folder sync and the diff, once the session is bound. */
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
					this.changed()
				},
				warn: (_key, message) => this.host.notify(this.id, message, 'warning'),
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
					if (kind !== 'transient') this.host.notify(this.id, `Task diff ${kind}: ${message}`, 'warning')
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

	private changed(): void {
		this.host.changed(this.id)
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
		await writeJsonFileAtomic(bindingPath(b.channel, b.opencodeSessionId), b).catch((err) =>
			log(`save: ${errorMessage(err)}`),
		)
	}

	private halt(reason: string): void {
		if (this.halted) return
		this.halted = reason
		log(`stopped ${this.id}: ${reason}`)
		this.closeLanes()
		this.host.notify(this.id, `Mirroring stopped: ${reason}`, 'error')
		this.changed()
	}

	/** At unload: a run still going ends as interrupted, then what is queued goes out, for up to FLUSH_MS. */
	shutdown(): Promise<void> {
		this.closing ??= (async () => {
			// Runs before this.closing is set, so these still queue.
			// opencode's unanswered permission requests end with it: the web app must not offer them.
			for (const [requestID, approval] of this.approvals) {
				if (approval.answeredBy) continue
				approval.answeredBy = 'opencode'
				if (approval.approvalId) this.push({ kind: 'resolve', requestID, decision: 'deny' }, 'api', true)
				else approval.decision = 'deny'
			}
			if (this.settling) this.finishSettle()
			else if (this.lastStatus === 'running') this.pushStatus('interrupted')
			const end = Date.now() + FLUSH_MS
			await Promise.all([
				this.outbox.drain(FLUSH_MS),
				this.artifacts?.flush(FLUSH_MS),
				this.diff?.flush(FLUSH_MS),
			])
			await this.saveNow()
			const left = this.outbox.length
			if (left > 0) log(`${this.id}: ${left} updates not sent`)
			if (Date.now() > end) log(`${this.id}: flush ran out of time`)
			this.outbox.close()
			this.closeLanes()
			this.abort.abort()
		})()
		return this.closing
	}
}

/** The HumanLayer link of an opencode session, once it has bound. */
export async function sessionUrl(sessionId: string): Promise<string | undefined> {
	const b = await readJsonFile<Binding>(bindingPath(await client.resolveChannel(), sessionId))
	return b?.cloudSessionId ? b.sessionUrl : undefined
}
