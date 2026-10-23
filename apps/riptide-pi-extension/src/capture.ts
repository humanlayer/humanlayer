// One Mirror per pi session. It binds the session to a cloud session at the first prompt
// (plan.md §4), sweeps new session entries through mapper.ts into the outbox (§5.1), and keeps
// the cloud status and the footer current (§5.4). Side lanes (lane.ts) follow the bound session.
// Handlers only queue work: outbox workers are the only places that wait on the network.

import { access } from 'node:fs/promises'

import type {
	AgentActivityOutcome,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	MessageEndEvent,
	SessionEntry,
	SlashCommandInfo,
	ToolCallEvent,
	ToolExecutionEndEvent,
} from '@earendil-works/pi-coding-agent'

import {
	type PrepareBody,
	type Prepared,
	prepare,
	type SessionCall,
	type SessionStatus,
	type SessionUpdate,
	sendSessionCall,
} from './api.ts'
import { artifactLane, artifactsHint, HINT_SECTION } from './artifacts.ts'
import { daemonOrgId, hostId, type Identity, identity } from './auth.ts'
import {
	type Binding,
	type Cursor,
	gitInfo,
	loadBinding,
	newBinding,
	newTask,
	type PrepareFacts,
	pickTask,
	prepareBody,
	promptText,
	repositoriesReport,
	saveBinding,
	sessionTitle,
} from './binding.ts'
import { type Channel, flushMs, getChannelConfig, guard, log, resolveChannel } from './config.ts'
import { diffLane } from './diffs.ts'
import { heartbeatLane } from './heartbeat.ts'
import { inboxLane } from './inbox.ts'
import { type LaneHost, Lanes } from './lane.ts'
import {
	type CloudEvent,
	createMapperState,
	type MappedEntry,
	type MapperState,
	mapEntry,
	resolveToCwd,
	systemEvent,
} from './mapper.ts'
import { type Backoff, Outbox, type QueueItem } from './outbox.ts'
import { type Plane, RpcError } from './rpc.ts'
import { loadSettings, type Mirroring } from './settings.ts'
import { Display } from './status.ts'
import type { ToolTarget } from './tools.ts'
import { errorMessage, sleepUnref } from './util.ts'

/** A run with nothing to send still tells the cloud it is alive this often. */
const KEEPALIVE_MS = 4 * 60_000

/** Nested calls of these tools may change the task folder or the repo. */
const NESTED_TOUCHES: ReadonlySet<string> = new Set(['write', 'edit', 'bash'])

/** Cloud sessions whose URL this process has shown. pi re-imports this module on /reload, which clears it. */
const announced = new Set<string>()

type Model = NonNullable<ExtensionContext['model']>

type Job =
	| { kind: 'prepare'; binding: Binding; body: PrepareBody; fallback: PrepareFacts | undefined }
	| ({ kind: 'rpc'; binding: Binding } & SessionCall)
	| { kind: 'cursor'; binding: Binding; cursor: Cursor }
type Item = QueueItem & Job
type PrepareItem = Extract<Item, { kind: 'prepare' }>

/** Test hooks: a shorter retry backoff. */
export type MirrorOptions = Backoff

/** The parts of pi the Mirror drives for web messages. index.ts builds it from `pi` and the session's ctx. */
export interface PiDriver {
	/** Starts a turn with the text as the user's message, or queues it as a follow-up when one is running. */
	send(text: string): void
	compact(): void
	abort(): void
	isIdle(): boolean
	/** The session's skills, which a web message can run as `/skill:name`. */
	skills(): SlashCommandInfo[]
}

/** The web composer sends `/compact` as the whole message, for the agent to act on itself. */
const COMPACT_COMMAND = '/compact'

export interface MirrorInfo {
	state: string
	task?: string
	url?: string
	queue: number
	lastError?: string
}

export class Mirror {
	private readonly sm: ExtensionContext['sessionManager']
	private readonly display: Display
	private readonly cwd: string
	private readonly flag: () => string | undefined
	private readonly opts: MirrorOptions
	private readonly driver: PiDriver | undefined
	private readonly timer: NodeJS.Timeout
	/** Bindings whose queued work is void: prepare failed, or attach replaced them before they bound. */
	private readonly dead = new WeakSet<Binding>()
	private channel: Channel
	private who: Identity | null = null
	private model: Model | undefined
	private outbox: Outbox<Item>
	private binding: Binding | undefined
	private state: MapperState
	/** Swept so far. binding.cursor is the acked position, the one saved to disk. */
	private pos: Cursor = { n: 0, lastId: null }
	private off = false
	/** Set by a failed prepare, a 402 or a 403/404. Only attach or on clears it. */
	private halted: string | undefined
	private attachTarget: string | undefined
	private active = false
	private outcome: AgentActivityOutcome = 'completed'
	private lastStatus: string | undefined
	private runError: string | undefined
	private lastError: string | undefined
	private lastSendAt = Date.now()
	private lastLeaf: string | null
	private saving: Promise<void> = Promise.resolve()
	private saveTimer: NodeJS.Timeout | undefined
	private alive = true
	private closing: Promise<void> | undefined
	private seq = 0
	/** Cuts short what is in flight once shutdown's flush time is up. */
	private readonly abort = new AbortController()
	private readonly lanes = new Lanes([artifactLane, diffLane, heartbeatLane, inboxLane])
	private synced: string | undefined

	private constructor(
		ctx: ExtensionContext,
		channel: Channel,
		flag: () => string | undefined,
		opts: MirrorOptions,
		driver: PiDriver | undefined,
	) {
		// ctx goes stale once this session ends, so keep only these parts of it.
		this.sm = ctx.sessionManager
		this.display = new Display(ctx)
		this.cwd = ctx.cwd
		this.model = ctx.model
		this.channel = channel
		this.flag = flag
		this.opts = opts
		this.driver = driver
		this.state = createMapperState(this.sm.getSessionId(), this.cwd)
		this.outbox = this.newOutbox()
		this.lastLeaf = this.sm.getLeafId()
		this.timer = setInterval(() => guard('tick', () => this.tick()), 1000)
		this.timer.unref()
	}

	/** For session_start. Local files only, no network. */
	static async start(
		ctx: ExtensionContext,
		flag: () => string | undefined,
		opts: MirrorOptions = {},
		driver?: PiDriver,
	): Promise<Mirror> {
		const [channel, mirroring] = await Promise.all([resolveChannel(), defaultMirroring()])
		const m = new Mirror(ctx, channel, flag, opts, driver)
		// A bound session keeps its own saved state: resume, in authChanged, overrides this.
		m.off = mirroring === 'off'
		await m.authChanged().catch((err) => log(`start: ${errorMessage(err)}`))
		return m
	}

	/** After start, login or logout: re-reads who is signed in and picks up this session's saved binding. */
	async authChanged(): Promise<void> {
		if (!this.binding) this.channel = await resolveChannel()
		this.who = await identity(this.channel)
		if (!this.binding && this.who) {
			const saved = await loadBinding(this.channel, this.sm.getSessionId(), this.who)
			if (saved && !this.binding && this.alive) this.resume(saved)
		}
		this.refreshStatus()
	}

	private resume(b: Binding): void {
		this.adopt(b)
		this.off = !!b.off
		log(`resuming ${b.cloudSessionId} at entry ${b.cursor.n}`)
		this.startLanes()
		this.sweep()
		if (!this.active) this.pushStatus('ready_for_input')
		this.announce(b)
	}

	private adopt(b: Binding): void {
		this.binding = b
		this.pos = { n: b.cursor.n, lastId: b.cursor.lastId }
		this.state = createMapperState(b.piSessionId, this.cwd)
		this.state.skipFirstUser = !!b.cursor.skipFirstUser
		this.lastStatus = undefined
	}

	async beforeAgentStart(
		event: BeforeAgentStartEvent,
		model: Model | undefined,
	): Promise<BeforeAgentStartEventResult | undefined> {
		this.model = model ?? this.model
		this.runError = undefined
		if (!this.binding && !this.off && !this.halted) await this.bind(event)
		this.sweep()
		return this.hint(event)
	}

	/**
	 * plan.md §6: every prompt of a bound or pending session names the task folder. It goes in as a
	 * section, so other extensions' sections stay. pi keeps the sections in the transcript even when
	 * an extension replaced the prompt, so set it then too, and add it to the replacement's text.
	 */
	private hint(event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined {
		const b = this.binding
		const text = b && !this.off && !this.halted ? artifactsHint(this.cwd, b) : undefined
		if (!text) return undefined
		const options = event.systemPromptOptions
		options.sections[HINT_SECTION] = text
		if (options.forceSystemPrompt === undefined) return undefined
		return { systemPrompt: `${event.systemPrompt}\n\n<${HINT_SECTION}>\n${text}\n</${HINT_SECTION}>` }
	}

	/**
	 * plan.md §4: the first prompt picks a task and queues prepare. It runs before pi appends the
	 * user entry, so the cursor starts past everything older and prepare carries the prompt itself.
	 */
	private async bind(event: BeforeAgentStartEvent): Promise<void> {
		this.channel = await resolveChannel()
		this.who = await identity(this.channel)
		if (!this.who) return this.refreshStatus()
		const id = this.sm.getSessionId()
		const [pick, git, host] = await Promise.all([
			pickTask(id, this.cwd, this.attachTarget, this.flag()),
			gitInfo(this.cwd),
			hostId(this.channel),
		])
		if (this.binding || this.off || this.halted || !this.alive) return
		this.attachTarget = undefined
		const model = this.model && { provider: this.model.provider, id: this.model.id }
		const title = sessionTitle(this.sm.getSessionName(), event.prompt)
		const prompt = promptText(event.prompt, event.images?.length ?? 0)
		const facts: PrepareFacts = { pick, hostId: host, title, prompt, cwd: this.cwd, model, git }
		const entries = this.sm.getEntries()
		const cursor = { n: entries.length, lastId: entries.at(-1)?.id ?? null, skipFirstUser: true }
		const b = newBinding({ channel: this.channel, piSessionId: id, cwd: this.cwd, pick, hostId: host, cursor, git })
		this.adopt(b)
		const fallback = pick.taskMode === 'use' && pick.auto ? facts : undefined
		this.push({ kind: 'prepare', binding: b, body: prepareBody(facts), fallback }, 'api', true)
		this.pushStatus('running', { ...this.modelFields(), codingAgentSessionId: id })
		if (git) this.pushCall({ path: 'sessions/repositories/report', body: repositoriesReport(git) })
		const parent = this.sm.getHeader()?.parentSession
		if (parent) {
			const payload = { kind: 'pi_fork', parentSessionFile: parent }
			this.pushEvent(systemEvent(this.state, `pi_fork:${b.createdAt}`, payload))
		}
		this.refreshStatus()
	}

	agentStart(): void {
		this.outcome = 'completed'
		this.active = true
		if (this.lastStatus !== 'running') this.pushStatus('running')
		this.sweep()
	}

	messageEnd(event: MessageEndEvent): void {
		const msg = event.message
		if (msg.role === 'assistant') {
			this.outcome = msg.stopReason === 'aborted' ? 'aborted' : msg.stopReason === 'error' ? 'error' : 'completed'
		}
		// pi appends the entry after message_end handlers return.
		setImmediate(() => guard('sweep', () => this.sweep()))
	}

	agentEnd(aborted: boolean): void {
		if (aborted) this.outcome = 'aborted'
		this.sweep()
	}

	beforeSettle(outcome: AgentActivityOutcome): void {
		if (this.outcome !== 'aborted') this.outcome = outcome
	}

	/** The run is over: send what is left, then the status it ended in. */
	agentSettled(): void {
		this.sweep()
		if (!this.active) return
		this.active = false
		this.state.createdFiles.clear()
		this.state.toolCalls.clear() // calls that never got a result, e.g. cut off by an abort
		if (this.outcome === 'aborted') this.pushStatus('interrupted')
		else if (this.outcome === 'error') this.pushStatus('failed', { errorMessage: this.runError })
		else this.pushStatus('ready_for_input')
	}

	compacting(on: boolean, reason?: 'manual' | 'threshold' | 'overflow'): void {
		if (on) this.state.compactionTrigger = reason === 'manual' ? 'manual' : 'auto'
		else this.sweep()
		this.pushUpdate({ isCompacting: on })
	}

	modelSelect(model: Model): void {
		this.model = model
		this.pushUpdate(this.modelFields())
		this.sweep()
	}

	/** Notes writes to new files, so their results read "File created successfully". Never throws. */
	async toolCall(event: ToolCallEvent): Promise<void> {
		if (event.toolName !== 'write' || !this.binding) return
		const path = event.input.path
		if (typeof path !== 'string') return
		const abs = resolveToCwd(path, this.cwd)
		if (
			!(await access(abs).then(
				() => true,
				() => false,
			))
		)
			this.state.createdFiles.set(event.toolCallId, abs)
	}

	/**
	 * A write, edit or bash call made by another tool, such as a codemode script, never reaches the
	 * transcript, so the task folder and the diff would miss it. Rescan both when one ends.
	 */
	nestedToolEnd(event: ToolExecutionEndEvent): void {
		if (event.parentToolCallId && NESTED_TOUCHES.has(event.toolName)) this.lanes.touched({})
	}

	/**
	 * Queues every entry past the swept position (plan.md §5.1). Cheap when nothing is new. While
	 * off or signed out it only moves the cursor, so nothing from that stretch is sent later.
	 */
	sweep(): void {
		const b = this.binding
		if (!b || this.halted || !this.alive) return
		const entries = this.sm.getEntries()
		let n = this.pos.n
		if (n > entries.length || (n > 0 && entries[n - 1]?.id !== this.pos.lastId)) {
			const i = entries.findIndex((e) => e.id === this.pos.lastId)
			n = i >= 0 ? i + 1 : entries.length // an unknown lastId skips to the end: old history is never sent
			log(`entries moved: resuming at ${n} of ${entries.length}`)
		}
		if (n === this.pos.n && n === entries.length) return
		if (!this.off && this.who) for (const entry of entries.slice(n)) this.queueEntry(entry)
		this.pos = { n: entries.length, lastId: entries.at(-1)?.id ?? null }
		const cursor: Cursor = { ...this.pos }
		if (this.state.skipFirstUser) cursor.skipFirstUser = true
		this.push({ kind: 'cursor', binding: b, cursor })
	}

	private queueEntry(entry: SessionEntry): void {
		let mapped: MappedEntry
		try {
			mapped = mapEntry(entry, this.state)
		} catch (err) {
			log(`skipped entry ${entry.id}: ${errorMessage(err)}`)
			return
		}
		for (const event of mapped.events) this.pushEvent(event)
		if (mapped.usage) this.pushUpdate({ ...mapped.usage, contextWindowLimit: this.contextWindow() }, false)
		if (mapped.errorMessage) this.runError = mapped.errorMessage
		if (mapped.touched) this.lanes.touched(mapped.touched)
	}

	private modelFields(): SessionUpdate {
		const id = this.model?.id
		return { model: id, resolvedModel: id, contextWindowLimit: this.contextWindow() }
	}

	private contextWindow(): number | undefined {
		return this.model?.contextWindow || undefined
	}

	/** Queues a call about the bound session, unless mirroring is off, halted or signed out. */
	private pushCall(call: SessionCall, keep = false): boolean {
		const b = this.binding
		if (!b || this.off || this.halted || !this.who) return false
		this.push({ kind: 'rpc', binding: b, ...call }, 'daemon', keep)
		return true
	}

	private pushEvent(event: CloudEvent): void {
		this.pushCall({ path: 'sessions/events/create', body: event })
	}

	/** Session updates stay queued past the cap, except usage, which the next one replaces. */
	private pushUpdate(fields: SessionUpdate, keep = true): boolean {
		return this.pushCall({ path: 'sessions/update', body: fields }, keep)
	}

	private pushStatus(status: SessionStatus, extra: SessionUpdate = {}): void {
		if (this.pushUpdate({ ...extra, status })) this.lastStatus = status
	}

	private push(job: Job, plane: Plane = 'daemon', keep = false): void {
		const sizeBytes = 'body' in job ? Buffer.byteLength(JSON.stringify(job.body)) : 64
		this.outbox.push({ ...job, id: String(++this.seq), plane, sizeBytes, keep })
	}

	private async send(item: Item): Promise<void> {
		const b = item.binding
		if (this.dead.has(b)) return
		if (item.kind === 'prepare') return this.sendPrepare(item)
		if (item.kind === 'cursor') {
			if (b !== this.binding) return
			b.cursor = item.cursor
			return this.saveSoon()
		}
		if (!b.cloudSessionId) return
		await sendSessionCall(b.channel, item, b.cloudSessionId, this.abort.signal)
		this.lastSendAt = Date.now()
	}

	private async sendPrepare(item: PrepareItem): Promise<void> {
		const b = item.binding
		// Read before prepare, so a login this needs fails before a session exists.
		const org = await daemonOrgId(b.channel, this.abort.signal)
		let out: Prepared
		try {
			out = await prepare(b.channel, item.body, this.abort.signal)
		} catch (err) {
			if (
				err instanceof RpcError &&
				err.status === 400 &&
				item.body.codingAgent === 'pi' &&
				namesCodingAgent(err)
			) {
				// An API from before the 'pi' coding agent rejects it; those sessions show as OpenCode.
				log(`prepare rejected codingAgent pi (${err.message}); retrying as opencode`)
				item.body = { ...item.body, codingAgent: 'opencode' }
				return this.sendPrepare(item)
			}
			if (!(err instanceof RpcError) || (err.status !== 403 && err.status !== 404)) throw err
			if (!item.fallback) return this.prepareFailed(b, err)
			// The worktree's own task is gone or not ours: make a task for this session instead.
			log(`task link ${b.taskSlug} failed (${err.status}); creating a task`)
			const pick = newTask(b.piSessionId)
			item.body = prepareBody({ ...item.fallback, pick })
			item.fallback = undefined
			b.taskMode = 'ensure'
			b.taskSlug = pick.slug
			return this.sendPrepare(item)
		}
		if (this.dead.has(b)) return
		b.cloudSessionId = out.sessionId
		b.taskId = out.taskId
		b.userId = out.userId
		b.orgId = org ?? this.who?.orgId
		b.sessionUrl = `${getChannelConfig(b.channel).app}/sessions/${out.sessionId}`
		this.lastSendAt = Date.now()
		void this.saveNow()
		this.startLanes()
		this.announce(b)
		this.refreshStatus()
	}

	/** Says where the session mirrors to, once per cloud session per process: at bind, pi -c or /resume. */
	private announce(b: Binding): void {
		if (!b.cloudSessionId || this.off || this.halted) return
		this.display.notifyOnce(b.cloudSessionId, `HumanLayer: mirroring to ${b.sessionUrl}`, 'info', announced)
	}

	private newOutbox(): Outbox<Item> {
		return new Outbox<Item>({
			send: (item) => this.send(item),
			onPause: () => this.refreshStatus(),
			onResume: () => this.refreshStatus(),
			onStopAll: (reason) => this.halt(reason),
			onStopBinding: (reason) => this.halt(reason),
			onSkip: (item, err) => {
				if (item.kind === 'prepare') return this.prepareFailed(item.binding, err)
				this.lastError = errorMessage(err)
			},
			onDrop: (item) => log(`queue full: dropped ${item.kind === 'rpc' ? item.path : item.kind}`),
			initialBackoffMs: this.opts.initialBackoffMs,
			maxBackoffMs: this.opts.maxBackoffMs,
		})
	}

	private prepareFailed(b: Binding, err: unknown): void {
		this.dead.add(b)
		if (b !== this.binding) return
		this.binding = undefined
		const status = err instanceof RpcError ? err.status : undefined
		const task = b.taskSlug ?? b.taskId
		if (status === 404)
			this.halt(`task ${task} not found. Use /humanlayer attach <task> or /humanlayer attach new.`)
		else if (status === 403) this.halt(`no access to task ${task}`)
		else this.halt(`could not start the cloud session: ${errorMessage(err)}`)
	}

	private halt(reason: string): void {
		this.halted = reason
		this.lastError = reason
		log(`stopped: ${reason}`)
		// A stopped outbox dropped the pending prepare with the rest of the queue.
		if (this.binding && !this.binding.cloudSessionId) {
			this.dead.add(this.binding)
			this.binding = undefined
		}
		this.closeLanes()
		this.display.notifyOnce(`halt:${reason}`, `HumanLayer: mirroring stopped: ${reason}`, 'error')
		this.refreshStatus()
	}

	/** Clears a halt. A stopped outbox lost its queue, so resend from the acked cursor. */
	private revive(): void {
		this.halted = undefined
		if (!this.outbox.isStopped) return
		this.outbox = this.newOutbox()
		if (this.binding) this.adopt(this.binding)
	}

	/** /humanlayer attach: the next prompt binds to this task ("new" makes one). */
	attach(target: string): void {
		const b = this.binding
		if (b?.cloudSessionId) {
			this.sweep()
			this.pushStatus('ready_for_input')
		} else if (b) this.dead.add(b)
		this.binding = undefined
		this.closeLanes()
		this.attachTarget = target
		this.off = false
		this.revive()
		this.refreshStatus()
	}

	/** /humanlayer off. See sweep. */
	setOff(): void {
		if (this.off) return
		const b = this.binding
		if (b) {
			this.sweep()
			this.pushStatus('ready_for_input')
			b.off = true
			void this.saveNow()
		}
		this.off = true
		this.closeLanes()
		this.refreshStatus()
	}

	setOn(): void {
		this.off = false
		this.revive()
		if (this.binding) {
			delete this.binding.off
			void this.saveNow()
			if (this.active) this.pushStatus('running')
			this.startLanes()
		}
		this.refreshStatus()
	}

	/** Starts the side lanes once the binding is bound. One set per binding. */
	private startLanes(): void {
		const b = this.binding
		if (!b?.cloudSessionId || !b.taskId || this.off || this.halted || !this.alive || this.lanes.for === b) return
		this.synced = undefined
		const driver = this.driver
		const host: LaneHost = {
			binding: b,
			taskId: b.taskId,
			sessionId: b.cloudSessionId,
			cwd: this.cwd,
			signal: this.abort.signal,
			backoff: this.opts,
			save: () => {
				if (b === this.binding) this.saveSoon()
			},
			note: (file) => {
				if (this.lanes.for !== b) return
				this.synced = file
				this.refreshStatus()
			},
			warn: (key, message) => this.display.notifyOnce(key, message, 'error'),
			web: driver && {
				resume: (prompt) => guard('web resume', () => this.webResume(b, prompt)),
				interrupt: () => guard('web interrupt', () => this.webInterrupt(b)),
				skills: () => driver.skills(),
			},
		}
		this.lanes.start(host)
	}

	/** A web reply to hand pi. Reports `running` at once, as riptide-daemon does, so the web app stops showing it as waiting. */
	private webResume(b: Binding, prompt: string): void {
		const driver = this.driver
		if (!driver || b !== this.binding || this.off) return
		log(`web message for ${b.cloudSessionId} (${prompt.length} chars)`)
		if (prompt.trim() === COMPACT_COMMAND) {
			// Compaction reports isCompacting itself; the session is waiting for input again after.
			this.pushStatus(driver.isIdle() ? 'ready_for_input' : 'running')
			driver.compact()
			return
		}
		this.pushStatus('running')
		this.state.webPrompts.push(prompt)
		driver.send(prompt)
		this.display.toast('HumanLayer: message from the web app')
	}

	/** The web stop button. A running turn ends as aborted, which reports `interrupted`; an idle one reports it now. */
	private webInterrupt(b: Binding): void {
		const driver = this.driver
		if (!driver || b !== this.binding || this.off) return
		log(`web interrupt for ${b.cloudSessionId}`)
		if (driver.isIdle()) this.pushStatus('interrupted')
		else driver.abort()
	}

	private closeLanes(): void {
		this.lanes.close()
		this.synced = undefined
	}

	/** Whether the HumanLayer tools should be on: bound or binding, and mirroring. */
	linked(): boolean {
		return !!this.binding && !this.off && !this.halted
	}

	/** The task the HumanLayer tools act on, or why there is none. */
	toolTarget(): ToolTarget {
		const b = this.binding
		if (!b || this.off || this.halted) {
			return {
				reason: 'This pi session is not linked to a HumanLayer task. Run /humanlayer attach <task> first.',
			}
		}
		if (!b.taskId)
			return { reason: 'HumanLayer is still linking this session to its task. Try again shortly.', pending: true }
		return { channel: b.channel, taskId: b.taskId }
	}

	info(): MirrorInfo {
		const b = this.binding
		const task = b ? (b.taskSlug ?? b.taskId) : this.attachTarget
		return {
			state: this.stateText(),
			task,
			url: b?.sessionUrl,
			queue: this.outbox.length,
			lastError: this.lastError,
		}
	}

	private stateText(): string {
		if (this.halted) return `stopped (${this.halted})`
		if (!this.who) return 'signed out'
		if (this.outbox.isPaused) return 'paused (login required)'
		if (this.off) return 'off'
		return this.binding ? 'on' : 'on (binds at the next prompt)'
	}

	private tick(): void {
		const leaf = this.sm.getLeafId()
		if (leaf !== this.lastLeaf) {
			this.lastLeaf = leaf
			this.sweep()
		}
		if (this.active && this.outbox.length === 0 && Date.now() - this.lastSendAt > KEEPALIVE_MS) {
			this.lastSendAt = Date.now()
			this.pushStatus('running')
		}
		this.refreshStatus()
	}

	private refreshStatus(): void {
		if (!this.alive) return
		const b = this.binding
		this.display.status({
			signedIn: !!this.who,
			problem: this.halted ?? (this.outbox.isPaused ? 'login required' : undefined),
			off: this.off,
			task: b ? (b.taskSlug ?? b.taskId?.slice(0, 8)) : undefined,
			queued: this.outbox.length,
			synced: this.synced,
		})
	}

	private saveSoon(): void {
		if (this.saveTimer) return
		this.saveTimer = setTimeout(() => void this.saveNow(), 2000)
		this.saveTimer.unref()
	}

	/** Saves a bound binding. Writes run one at a time; the returned promise settles after this one. */
	private saveNow(): Promise<void> {
		clearTimeout(this.saveTimer)
		this.saveTimer = undefined
		const b = this.binding
		if (b?.cloudSessionId) {
			this.saving = this.saving.then(() => saveBinding(b)).catch((err) => log(`save: ${errorMessage(err)}`))
		}
		return this.saving
	}

	/**
	 * session_shutdown: send what is queued and scan the task files (up to flushMs in all), save the
	 * acked cursor and the ledger, say what did not go out, then go quiet and cut short what is
	 * still in flight.
	 */
	shutdown(waitForAgent = false): Promise<void> {
		return (this.closing ??= this.flushAndClose(waitForAgent))
	}

	private async flushAndClose(waitForAgent: boolean): Promise<void> {
		const ms = flushMs()
		const deadline = Date.now() + ms
		// Print mode ends when nothing holds Node's event loop, and retries wait on unref'd timers.
		const hold = setTimeout(() => {}, ms + 2000)
		try {
			this.sweep()
			// SIGINT aborts the agent; SIGTERM kills its tool. Let final entries land before
			// "interrupted", but count this grace period against the shared flush budget.
			const end = Math.min(deadline, Date.now() + 1000)
			while (this.active && (waitForAgent || this.state.toolCalls.size > 0) && Date.now() < end) {
				await sleepUnref(20)
				this.sweep()
			}
			if (this.active) {
				this.active = false
				this.pushStatus('interrupted')
			}
			clearInterval(this.timer)
			await Promise.all([this.outbox.drain(Math.max(0, deadline - Date.now())), this.flushLanes(deadline)])
			await this.saveNow()
			this.reportUnsent()
		} finally {
			this.alive = false
			this.display.close()
			clearInterval(this.timer)
			this.outbox.close()
			this.closeLanes()
			this.abort.abort()
			clearTimeout(hold)
		}
	}

	/** At shutdown: a session that never bound stops with the reason; a bound one counts what is left. */
	private reportUnsent(): void {
		const b = this.binding
		if (!b || this.halted) return
		if (!b.cloudSessionId) return this.prepareFailed(b, this.outbox.failure ?? 'no answer in time')
		const n = this.outbox.items.filter((item) => item.kind === 'rpc' && item.binding === b).length
		if (n > 0)
			this.display.notifyOnce(
				'unsent',
				`HumanLayer: ${n} updates not sent; run pi again with -c in this folder to send them.`,
				'error',
			)
	}

	/** Waits for a pending prepare (success starts the lanes), then flushes the lanes until end. */
	private async flushLanes(end: number): Promise<void> {
		const pending = () => this.binding && !this.binding.cloudSessionId && !this.halted && !this.outbox.isPaused
		while (pending() && Date.now() < end) await sleepUnref(50)
		await this.lanes.flush(end)
	}
}

/** An input check that failed on codingAgent: zod names the field in the message and the data. */
/** The saved default for new sessions. A settings file it can't read starts the session off. */
async function defaultMirroring(): Promise<Mirroring> {
	try {
		return (await loadSettings()).defaultMirroring
	} catch (err) {
		log(`settings: ${errorMessage(err)}; this session starts off`)
		return 'off'
	}
}

function namesCodingAgent(err: RpcError): boolean {
	return /codingAgent/.test(`${err.message} ${JSON.stringify(err.data ?? null)}`)
}
