// One Mirror per Claude Code session. The first prompt binds the session to a new cloud session
// (automation/run/prepare, which writes that prompt itself); after that the transcript file goes
// through mapper.ts into the outbox, Claude Code's turns become the cloud status, the task folder
// syncs through @humanlayer/session-sdk-artifacts, and the task diff through
// @humanlayer/session-sdk-diffs. Web replies and stops come in through web() and stop(), and go to
// the mod as actions. Approvals wait in ask() for whichever side answers first.
//
// A binding is saved by Claude Code session id, with how far into each transcript file the cloud
// has taken it, so a resumed session sends what the cloud never confirmed, and nothing twice.

import { type FSWatcher, watch } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ArtifactSync, artifactsHint, type LedgerEntry, safeSlug, taskFolder } from '@humanlayer/session-sdk-artifacts'
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
	promptText,
	recordLink,
	repositoriesReport,
	type TaskPick,
} from '@humanlayer/session-sdk-sessions'
import type { ToolTarget } from '@humanlayer/session-sdk-tools'

import { artifactsDir, bindingsDir, client, CODING_AGENT, FLUSH_MS, linksPath, log } from './config.ts'
import {
	type CloudEvent,
	createMapperState,
	expectCloudPrompt,
	findOpenCall,
	type Mapped,
	mapApprovalCall,
	mapLine,
	type MapperState,
} from './mapper.ts'
import type { Action, ApprovalAnswer, ApprovalAsk } from './protocol.ts'
import { fileSize, mainKey, readLines, subagentFiles } from './transcript.ts'

/** How long a finished turn waits for its open tool calls and the transcript's last lines. */
const SETTLE_MS = 2000

/** After a nudge, the transcript is read this often, for this long. */
const FOLLOW_EVERY_MS = 500
const FOLLOW_MS = 10_000

/** A turn's end reads the transcript again after this, for rows still being written. */
const TURN_END_READ_MS = 300

/** How long a permission ask waits for its call's transcript line: ASK_WAITS reads, ASK_WAIT_MS apart. */
const ASK_WAITS = 5
const ASK_WAIT_MS = 200

/** A long quiet turn repeats `running` this often, so the session never looks stuck. */
const RUNNING_REPEAT_MS = 4 * 60 * 1000

export interface Binding {
	version: 1
	channel: Channel
	claudeSessionId: string
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
	transcriptPath: string
	/** How far into each transcript file the cloud has taken, in bytes, by file name. */
	cursors: Record<string, number>
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
	 * A turn was running in Claude Code process pid, with these approvals open in the cloud. A
	 * clean exit clears it; a start that finds it set, with that process gone, follows a crash.
	 */
	running?: { pid: number; approvalIds: string[] }
	/** The last status sent: a resumed session sends it again after the events it catches up on. */
	status?: string
}

/** What a Mirror needs from the server around it. */
export interface MirrorHost {
	/** A notice for the terminal, shown once. */
	notify(message: string): void
	/** The session's state changed: the footer should be drawn again. */
	changed(): void
	/** The session bound: the host should beat, follow web messages and report skills for its channel. */
	bound(b: Binding): void
	/** Hands the mod work for this session. */
	act(action: Action): void
	/** Whether the session has a slash command or skill by this name. */
	hasCommand(name: string): boolean
	/** The Claude Code process this server belongs to. */
	claudePid: number
}

/** What the footer and `/humanlayer status` show for one session. */
export interface SessionInfo {
	state: 'unbound' | 'binding' | 'mirroring' | 'off' | 'stopped'
	task?: string
	url?: string
	/** Updates waiting to send. */
	queued: number
	/** The last task file synced. */
	synced?: string
	/** Why mirroring stopped, when it did. */
	problem?: string
	/** The task the next prompt binds to, after an attach. */
	attach?: string
}

/** One of Claude Code's permission asks, as HumanLayer's approval of it. */
interface Approval {
	/** Set once approvals/create answers. */
	approvalId?: string
	/** Who answered first. */
	answeredBy?: 'web' | 'terminal'
	/** An answer in the terminal before the approval existed in the cloud: sent once it does. */
	decision?: 'approve' | 'deny'
	/** The mod's hook, waiting for the web's answer. */
	reply?: (answer: ApprovalAnswer) => void
	/** The tool and its input, which find an approval whose ask named no call. */
	tool?: string
	inputKey?: string
}

/** JSON with object keys sorted, so two copies of one input compare equal. */
function stableJson(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) =>
		v && typeof v === 'object' && !Array.isArray(v)
			? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
			: v,
	)
}

type SessionStatus = Extract<
	NonNullable<DaemonRequest<'sessions/update'>['status']>,
	'running' | 'ready_for_input' | 'interrupted' | 'failed'
>
type SessionUpdate = Omit<DaemonRequest<'sessions/update'>, 'sessionId'> & { status?: SessionStatus }

type Job =
	| { kind: 'prepare'; body: PrepareBody; fallback?: Omit<PrepareFacts, 'pick'> }
	| { kind: 'approval'; toolUseId: string; body: Omit<DaemonRequest<'approvals/create'>, 'sessionId'> }
	| { kind: 'resolve'; toolUseId: string; decision: 'approve' | 'deny' }
	| { kind: 'rename'; title: string }
	| { kind: 'rpc'; path: 'sessions/update'; body: SessionUpdate }
	| { kind: 'rpc'; path: 'sessions/events/create'; body: CloudEvent }
	| { kind: 'rpc'; path: 'sessions/repositories/report'; body: ReturnType<typeof repositoriesReport> }
/** `cursor`: the transcript line this item came from, which the binding's cursor moves past once it is sent. */
type Item = QueueItem & Job & { cursor?: [file: string, end: number] }

function bindingPath(channel: Channel, sessionId: string): string {
	return join(bindingsDir(channel), `${sessionId}.json`)
}

/** The saved binding, unless it belongs to another host, or (device login) another user or org. */
async function loadBinding(channel: Channel, sessionId: string, who: Identity): Promise<Binding | undefined> {
	const b = await readJsonFile<Binding>(bindingPath(channel, sessionId))
	if (b?.version !== 1 || !b.cloudSessionId || b.channel !== channel || b.hostId !== (await client.hostId(channel)))
		return undefined
	if (who.source === 'device' && (b.userId !== who.userId || b.orgId !== who.orgId)) return undefined
	return b
}

/** Whether a process is running. Signal 0 checks without sending anything. */
export function alive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === 'EPERM'
	}
}

/** Session and task name: the prompt's first line cut to 80 characters. */
function sessionTitle(prompt: string): string {
	const line = prompt.split('\n').find((l) => l.trim()) ?? ''
	return Array.from(line.trim()).slice(0, 80).join('').trim() || 'Claude Code session'
}

/** A web message's leading `/name`, split from the rest. */
export function slashCommand(text: string): { name: string; args: string } | undefined {
	const m = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
	return m?.[1] ? { name: m[1], args: m[2]?.trim() ?? '' } : undefined
}

/** The statuses a turn ends in. */
function isResting(status: string): status is 'ready_for_input' | 'interrupted' | 'failed' {
	return status === 'ready_for_input' || status === 'interrupted' || status === 'failed'
}

/** An event riptide-api takes as proof the agent is working (events/create's provesActiveExecution). */
function provesWork(e: CloudEvent): boolean {
	if (e.role === 'user') return e.eventType === 'tool_result'
	return (
		e.role === 'assistant' &&
		(e.eventType === 'message' || e.eventType === 'thinking' || e.eventType === 'tool_call')
	)
}

/** Whether a tool's error result says the user turned it down. */
function isRefusal(text: string | undefined): boolean {
	return /doesn't want to proceed|does not want to proceed|rejected|denied|declined/i.test(text ?? '')
}

export class Mirror {
	private readonly host: MirrorHost
	private readonly binding: Binding
	private readonly state: MapperState
	/** Subagent files' mapper states, by file name. */
	private readonly subagents = new Map<string, MapperState>()
	/** How far each transcript file has been read, by file name. */
	private readonly readEnds: Record<string, number>
	private outbox: Outbox<Item>
	private readonly abort = new AbortController()
	private seq = 0
	private model: string | undefined
	private contextWindow: number | undefined
	private lastStatus: SessionStatus | undefined
	private turnId: string | undefined
	private halted: string | undefined
	private closing: Promise<void> | undefined
	/** Set once the exit's last updates are queued: nothing new goes up after. */
	private ended = false
	private artifacts: ArtifactSync | undefined
	private diff: DiffSync | undefined
	private synced: string | undefined
	private saveTimer: NodeJS.Timeout | undefined
	private runningTimer: NodeJS.Timeout | undefined
	private readTimer: NodeJS.Timeout | undefined
	private followTimer: NodeJS.Timeout | undefined
	private followUntil = 0
	private watcher: FSWatcher | undefined
	private reading: Promise<void> = Promise.resolve()
	/** Claude Code's permission asks that went to HumanLayer, by tool call id. */
	private readonly approvals = new Map<string, Approval>()
	/** The status a finished turn reports once its open tool calls end, or SETTLE_MS passes. */
	private settling: { status: SessionStatus; extra: SessionUpdate; timer: NodeJS.Timeout } | undefined

	private constructor(host: MirrorHost, binding: Binding) {
		this.host = host
		this.binding = binding
		this.state = createMapperState(binding.claudeSessionId)
		this.readEnds = { ...binding.cursors }
		this.outbox = this.newOutbox()
		this.watchTranscript()
	}

	/**
	 * Reads when the transcript file changes, whatever wrote it: rows Claude Code stores outside a
	 * turn (a /compact's boundary and summary) come with no nudge from the mod.
	 */
	private watchTranscript(): void {
		const file = basename(this.binding.transcriptPath)
		try {
			this.watcher = watch(dirname(this.binding.transcriptPath), (_event, name) => {
				if (name === file) this.scheduleRead()
			})
			this.watcher.unref()
			this.watcher.on('error', () => this.watcher?.close())
		} catch (err) {
			log(`watch: ${errorMessage(err)}`)
		}
	}

	get id(): string {
		return this.binding.claudeSessionId
	}

	/** The Claude Code sessions in cwd whose last turn ended with their process, from the saved bindings. */
	static async lostRuns(channel: Channel, cwd: string): Promise<string[]> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		const lost: string[] = []
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (b?.cwd === cwd && b.running && !alive(b.running.pid)) lost.push(b.claudeSessionId)
		}
		return lost
	}

	/** The Claude Code session in cwd that mirrors to this cloud session, from the saved bindings. */
	static async find(channel: Channel, cloudSessionId: string, cwd: string): Promise<string | undefined> {
		const files = await readdir(bindingsDir(channel)).catch(() => [])
		for (const file of files) {
			if (!file.endsWith('.json')) continue
			const b = await readJsonFile<Binding>(join(bindingsDir(channel), file))
			if (b?.cloudSessionId === cloudSessionId && b.cwd === cwd) return b.claudeSessionId
		}
		return undefined
	}

	/** The session's saved binding, if it has one this login can use. */
	static async resume(
		host: MirrorHost,
		sessionId: string,
		who: Identity,
		transcriptPath: string | undefined,
	): Promise<Mirror | undefined> {
		const saved = await loadBinding(who.channel, sessionId, who)
		if (!saved) return undefined
		log(`resuming ${saved.cloudSessionId} for ${sessionId}`)
		saved.cursors ??= {}
		if (transcriptPath && transcriptPath !== saved.transcriptPath) saved.transcriptPath = transcriptPath
		const m = new Mirror(host, saved)
		if (saved.status && isResting(saved.status)) m.lastStatus = saved.status
		m.startLanes()
		if (saved.running && saved.running.pid !== host.claudePid && !alive(saved.running.pid))
			m.endLostRun(saved.running.approvalIds)
		m.scheduleRead(0) // what the cloud never confirmed
		return m
	}

	/** The last Claude Code process ended mid-turn without a clean exit: its turn and approvals are gone. */
	endLostRun(approvalIds: string[]): void {
		log(`${this.id}: the last turn ended with its process; reporting it interrupted`)
		for (const approvalId of approvalIds) {
			const toolUseId = `lost-${approvalId}`
			this.approvals.set(toolUseId, { approvalId, answeredBy: 'terminal' })
			this.push({ kind: 'resolve', toolUseId, decision: 'deny' }, 'api', true)
		}
		this.pushStatus('interrupted')
	}

	/**
	 * A new cloud session for this Claude Code session, with its first prompt. Queues prepare, the
	 * running status and the repository report; nothing waits on the network here.
	 */
	static async bind(
		host: MirrorHost,
		o: {
			sessionId: string
			cwd: string
			transcriptPath: string
			who: Identity
			prompt: string
			images: number
			model?: string
			pick: TaskPick
		},
	): Promise<Mirror> {
		const channel = o.who.channel
		const [hostId, git] = await Promise.all([client.hostId(channel), gitInfo(o.cwd)])
		// History from before the link stays local: the transcript is sent from here on.
		const cursors: Record<string, number> = { [mainKey(o.transcriptPath)]: await fileSize(o.transcriptPath) }
		for (const f of await subagentFiles(o.transcriptPath)) cursors[f.name] = await fileSize(f.path)
		const binding: Binding = {
			version: 1,
			channel,
			claudeSessionId: o.sessionId,
			cwd: o.cwd,
			createdAt: new Date().toISOString(),
			hostId,
			taskMode: o.pick.taskMode,
			transcriptPath: o.transcriptPath,
			cursors,
		}
		const slug = o.pick.taskMode === 'ensure' ? o.pick.slug : o.pick.taskSlug
		if (slug) binding.taskSlug = slug
		else if (o.pick.taskMode === 'use') binding.taskId = o.pick.taskIdOrSlug
		if (git) binding.git = git
		const m = new Mirror(host, binding)
		m.model = o.model
		const prompt = promptText(o.prompt, o.images)
		expectCloudPrompt(m.state, o.prompt)
		const facts = {
			codingAgent: CODING_AGENT,
			hostId,
			title: sessionTitle(o.prompt),
			prompt,
			cwd: o.cwd,
			model: o.model ? { provider: 'anthropic', id: o.model } : undefined,
			git,
		}
		// The worktree's own task may be gone or not ours: prepare then makes a task instead.
		const fallback = o.pick.taskMode === 'use' && o.pick.auto ? facts : undefined
		m.push({ kind: 'prepare', body: prepareBody({ ...facts, pick: o.pick }), fallback }, 'api', true)
		m.pushStatus('running', { ...m.modelFields(), codingAgentSessionId: o.sessionId })
		m.startRunningRepeat()
		if (git) m.push({ kind: 'rpc', path: 'sessions/repositories/report', body: repositoriesReport(git) })
		m.changed()
		return m
	}

	/** The system prompt section that names the task folder, and the session's link once it has one. */
	hint(): string | undefined {
		if (!this.active) return undefined
		return artifactsHint(this.binding.cwd, this.binding.taskSlug, this.binding.sessionUrl)
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

	get cloudSessionId(): string | undefined {
		return this.binding.cloudSessionId
	}

	get channel(): Channel {
		return this.binding.channel
	}

	get cwd(): string {
		return this.binding.cwd
	}

	/** Whether the outbox waits for a new login. */
	get loginRequired(): boolean {
		return this.outbox.isPaused
	}

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
		return !this.halted && !this.binding.off && !this.ended
	}

	// ---- Claude Code's side ----

	/** A model turn began: a typed prompt, a web message, or a continuation. */
	turnStart(turnId: string): void {
		this.turnId = turnId
		this.cancelSettle()
		if (this.lastStatus !== 'running') this.pushStatus('running')
		this.startRunningRepeat()
		this.scheduleRead()
	}

	/** A model turn ended. The status waits for the transcript's last lines and open tool calls. */
	async turnEnd(
		reason: 'answer' | 'aborted' | 'refusal' | 'error',
		contextWindow: number | undefined,
	): Promise<void> {
		this.turnId = undefined
		this.stopRunningRepeat()
		if (contextWindow && contextWindow !== this.contextWindow) {
			this.contextWindow = contextWindow
			this.pushUpdate({ contextWindowLimit: contextWindow })
		}
		await this.read()
		// The turn's last rows may still be on their way to the file.
		await new Promise((r) => setTimeout(r, TURN_END_READ_MS).unref())
		await this.read()
		if (reason === 'aborted') return this.settle('interrupted')
		if (reason === 'error')
			return this.settle('failed', { errorMessage: this.lastError ?? 'The model request failed.' })
		this.settle('ready_for_input')
	}

	private lastError: string | undefined

	/** Claude Code stored transcript rows. */
	rows(): void {
		this.scheduleRead()
	}

	/** A tool call finished. An approval still open for it was answered in the terminal. */
	toolDone(
		callId: string | undefined,
		tool: string,
		input: Record<string, unknown>,
		isError: boolean,
		text: string | undefined,
	): void {
		this.scheduleRead()
		// An ask that named no call went up under a made-up id: it is found by its tool and input.
		const key = stableJson(input)
		const toolUseId =
			callId && this.approvals.has(callId)
				? callId
				: [...this.approvals].find(([, a]) => !a.answeredBy && a.tool === tool && a.inputKey === key)?.[0]
		if (!toolUseId) return
		const approval = this.approvals.get(toolUseId)
		if (!approval || approval.answeredBy) return
		approval.answeredBy = 'terminal'
		approval.reply?.({ behavior: 'none' })
		approval.reply = undefined
		const decision = isError && isRefusal(text) ? 'deny' : 'approve'
		if (approval.approvalId) this.push({ kind: 'resolve', toolUseId, decision }, 'api', true)
		else approval.decision = decision
		this.noteRun()
	}

	/**
	 * Claude Code asks before a tool runs, and shows its own prompt meanwhile. The web app shows the
	 * same question on the tool's card; whichever side answers first wins. Resolves with the web's
	 * answer, or `none` once the terminal answered or the approval can't reach the web.
	 */
	async ask(a: ApprovalAsk): Promise<ApprovalAnswer> {
		if (!this.active || !this.binding.cloudSessionId) return { behavior: 'none' }
		await this.read()
		// The approval needs its call on the web first. A call not yet in the transcript goes up now.
		let state = this.stateForAgent(a.agentId)
		let found = a.toolUseId ?? findOpenCall(state, a.tool, a.input)
		// Claude Code may ask before it writes the call's line: wait for it briefly, or the web gets a second card.
		for (let i = 0; !found && i < ASK_WAITS; i++) {
			await new Promise((r) => setTimeout(r, ASK_WAIT_MS).unref())
			await this.read()
			state = this.stateForAgent(a.agentId)
			found = findOpenCall(state, a.tool, a.input)
		}
		const toolUseId = found ?? `ask-${++this.seq}`
		this.queue(mapApprovalCall(state, toolUseId, a.tool, a.input))
		const existing = this.approvals.get(toolUseId)
		if (existing?.answeredBy) return { behavior: 'none' }
		return new Promise<ApprovalAnswer>((resolve) => {
			this.approvals.set(toolUseId, { ...existing, reply: resolve, tool: a.tool, inputKey: stableJson(a.input) })
			const body: Extract<Job, { kind: 'approval' }>['body'] = { toolName: a.tool, toolInput: a.input, toolUseId }
			this.push({ kind: 'approval', toolUseId, body }, 'daemon', true)
		})
	}

	/** The mapper state a subagent's call belongs to: its file's, once read, else the session's. */
	private stateForAgent(agentId: string | undefined): MapperState {
		if (!agentId) return this.state
		return this.subagents.get(`agent-${agentId}.jsonl`) ?? this.state
	}

	/** The web app answered an approval. False when it is not one of this session's. */
	answered(approvalId: string, approved: boolean, comment: string | undefined): boolean {
		for (const approval of this.approvals.values()) {
			if (approval.approvalId !== approvalId) continue
			if (approval.answeredBy) return true
			approval.answeredBy = 'web'
			log(`web ${approved ? 'approval' : 'denial'} for ${this.binding.cloudSessionId}`)
			const answer: ApprovalAnswer = approved
				? { behavior: 'allow' }
				: { behavior: 'deny', message: comment || 'Denied in HumanLayer.' }
			approval.reply?.(answer)
			approval.reply = undefined
			this.noteRun()
			return true
		}
		return false
	}

	// ---- the web app's side ----

	/** A web reply. Reports `running` at once, as riptide-daemon does, so the web app stops showing it as waiting. */
	web(text: string): void {
		if (!this.active) return
		log(`web message for ${this.binding.cloudSessionId} (${text.length} chars)`)
		this.pushStatus('running')
		this.host.notify('Message from the web app')
		expectCloudPrompt(this.state, text)
		const slash = slashCommand(text)
		const sessionId = this.id
		if (slash?.name === 'compact') this.host.act({ kind: 'compact', sessionId })
		else if (slash && this.host.hasCommand(slash.name))
			this.host.act({ kind: 'command', sessionId, command: slash.name, args: slash.args })
		else this.host.act({ kind: 'submit', sessionId, text })
	}

	/** A web message the mod could not start. */
	webFailed(reason: string): void {
		this.host.notify(`Could not start the web message: ${reason}`)
		this.pushStatus('ready_for_input')
	}

	/**
	 * The web stop button. Open approvals are denied first, so the terminal never keeps a question
	 * with no turn behind it; then the turn stops. An idle session reports interrupted now.
	 */
	stop(): void {
		if (!this.active) return
		log(`web interrupt for ${this.binding.cloudSessionId}`)
		let denied = false
		for (const [toolUseId, approval] of this.approvals) {
			if (approval.answeredBy) continue
			approval.answeredBy = 'web'
			approval.reply?.({ behavior: 'deny', message: 'Stopped from HumanLayer.', interrupt: true })
			approval.reply = undefined
			if (approval.approvalId) this.push({ kind: 'resolve', toolUseId, decision: 'deny' }, 'api', true)
			else approval.decision = 'deny'
			denied = true
		}
		if (this.lastStatus === 'running' && !this.settling) {
			// A denied approval stops the turn itself; the abort covers a turn with none open.
			if (!denied) this.host.act({ kind: 'abort', sessionId: this.id })
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

	// ---- the transcript ----

	/**
	 * Reads every FOLLOW_EVERY_MS for a while after Claude Code's last sign of life. Claude Code
	 * writes its transcript a little after it stores each row, so no single read after a nudge is
	 * sure to see it.
	 */
	private follow(ms = FOLLOW_MS): void {
		this.followUntil = Math.max(this.followUntil, Date.now() + ms)
		if (this.followTimer) return
		this.followTimer = setInterval(() => {
			if (Date.now() > this.followUntil) return this.stopFollowing()
			void this.read()
		}, FOLLOW_EVERY_MS)
		this.followTimer.unref()
	}

	private stopFollowing(): void {
		clearInterval(this.followTimer)
		this.followTimer = undefined
	}

	/** Reads the transcript soon: rows land in the file a little after Claude Code stores them. */
	private scheduleRead(ms = 100): void {
		this.follow()
		if (this.readTimer) return
		this.readTimer = setTimeout(() => {
			this.readTimer = undefined
			void this.read()
		}, ms)
		this.readTimer.unref()
	}

	/** Reads every transcript file to its last whole line, one read at a time. */
	read(): Promise<void> {
		const run = this.reading.then(() => this.readOnce())
		this.reading = run.catch((err) => log(`read: ${errorMessage(err)}`))
		return this.reading
	}

	private async readOnce(): Promise<void> {
		const path = this.binding.transcriptPath
		await this.readFile(mainKey(path), path, this.state)
		for (const f of await subagentFiles(path)) {
			let state = this.subagents.get(f.name)
			if (!state) {
				// A subagent file with no Agent call to nest under can't show on the web.
				if (!f.toolUseId) continue
				state = createMapperState(this.id, f.toolUseId)
				this.subagents.set(f.name, state)
			}
			await this.readFile(f.name, f.path, state)
		}
		if (this.settling && this.openTools() === 0) this.finishSettle()
	}

	private async readFile(key: string, path: string, state: MapperState): Promise<void> {
		for (const { line, end } of await readLines(path, this.readEnds[key] ?? 0)) {
			this.readEnds[key] = end
			// Off: the lines are passed over, never sent.
			if (!this.active) continue
			const mapped = mapLine(line, state)
			this.queue(mapped, [key, end])
		}
		if (!this.active) this.binding.cursors[key] = this.readEnds[key] ?? 0
	}

	private openTools(): number {
		let n = this.state.openTools.size
		for (const s of this.subagents.values()) n += s.openTools.size
		return n
	}

	private queue(mapped: Mapped, cursor?: [string, number]): void {
		for (const event of mapped.events)
			this.push({ kind: 'rpc', path: 'sessions/events/create', body: event, cursor }, 'daemon')
		// The API moves a resting session back to running on such an event: a row that reaches the
		// file after the turn ended must not leave the session looking busy.
		const resting = this.lastStatus
		if (resting && resting !== 'running' && !this.turnId && !this.settling && mapped.events.some(provesWork))
			this.pushUpdate({ status: resting })
		if (mapped.usage) this.pushUpdate({ ...mapped.usage, contextWindowLimit: this.contextWindow }, false)
		if (mapped.contextTokens) this.pushUpdate({ contextWindowTokens: mapped.contextTokens }, false)
		if (mapped.model && mapped.model !== this.model) {
			this.model = mapped.model
			this.pushUpdate(this.modelFields())
		}
		if (mapped.title) this.push({ kind: 'rename', title: mapped.title }, 'api')
		if (mapped.errorMessage) this.lastError = mapped.errorMessage
		for (const path of mapped.touched ?? []) this.touched({ path })
		if (mapped.scan) this.touched({})
	}

	private touched(t: { path?: string }): void {
		this.artifacts?.touched(t)
		this.diff?.touched()
	}

	// ---- status ----

	/** A turn ended. The status waits for open tool calls: a tool result after it would read as running again. */
	private settle(status: SessionStatus, extra: SessionUpdate = {}): void {
		this.cancelSettle()
		this.touched({})
		const timer = setTimeout(() => {
			this.state.openTools.clear() // calls that never got a result
			for (const s of this.subagents.values()) s.openTools.clear()
			this.finishSettle()
		}, SETTLE_MS)
		timer.unref()
		this.settling = { status, extra, timer }
		if (this.openTools() === 0) this.finishSettle()
		else this.scheduleRead(250)
	}

	private finishSettle(): void {
		const s = this.settling
		if (!s) return
		this.cancelSettle()
		this.lastError = undefined
		this.pushStatus(s.status, s.extra)
	}

	private cancelSettle(): void {
		if (this.settling) clearTimeout(this.settling.timer)
		this.settling = undefined
	}

	private startRunningRepeat(): void {
		this.stopRunningRepeat()
		this.runningTimer = setInterval(() => {
			if (this.lastStatus === 'running') this.pushUpdate({ status: 'running' })
		}, RUNNING_REPEAT_MS)
		this.runningTimer.unref()
	}

	private stopRunningRepeat(): void {
		clearInterval(this.runningTimer)
		this.runningTimer = undefined
	}

	private modelFields(): SessionUpdate {
		const id = this.model
		return { model: id, resolvedModel: id, contextWindowLimit: this.contextWindow }
	}

	/** Session updates stay queued past the cap, except usage, which the next one replaces. */
	private pushUpdate(fields: SessionUpdate, keep = true): void {
		this.push({ kind: 'rpc', path: 'sessions/update', body: fields }, 'daemon', keep)
	}

	private pushStatus(status: SessionStatus, extra: SessionUpdate = {}): void {
		this.lastStatus = status
		if (this.binding.status !== status) {
			this.binding.status = status
			this.saveSoon()
		}
		this.pushUpdate({ ...extra, status })
		this.noteRun()
	}

	/** Saves whether a turn is going, and its open approvals, for the next start after a crash. */
	private noteRun(): void {
		const b = this.binding
		const approvalIds = [...this.approvals.values()]
			.filter((a) => a.approvalId && !a.answeredBy)
			.map((a) => a.approvalId ?? '')
		const running = this.lastStatus === 'running' ? { pid: this.host.claudePid, approvalIds } : undefined
		if (JSON.stringify(running) === JSON.stringify(b.running)) return
		b.running = running
		void this.saveNow()
	}

	// ---- sending ----

	private push(job: Job & { cursor?: [string, number] }, plane: 'api' | 'daemon' = 'daemon', keep = false): void {
		if (this.halted || this.binding.off || this.ended) return
		const sizeBytes = Buffer.byteLength(JSON.stringify('body' in job ? job.body : job))
		this.outbox.push({ ...job, id: String(++this.seq), plane, sizeBytes, keep })
		this.changed()
	}

	private newOutbox(): Outbox<Item> {
		return new Outbox<Item>({
			send: async (item) => {
				try {
					await this.send(item)
					this.sent(item)
				} finally {
					this.changed()
				}
			},
			log,
			onPause: () => this.changed(),
			onResume: () => this.changed(),
			onStopAll: (reason) => this.halt(reason),
			onStopBinding: (reason) => this.halt(reason),
			onSkip: (item, err) => {
				this.sent(item)
				if (item.kind === 'prepare') this.halt(`could not start the cloud session: ${errorMessage(err)}`)
				if (item.kind === 'approval') this.approvalFailed(item.toolUseId)
			},
			onDrop: (item) => log(`queue full: dropped ${item.kind === 'rpc' ? item.path : item.kind}`),
		})
	}

	/** An item left the queue: the transcript cursor moves past its line, and past every line read once the queue is empty. */
	private sent(item: Item): void {
		const b = this.binding
		if (!b.cloudSessionId) return
		if (this.outbox.length <= 1) Object.assign(b.cursors, this.readEnds)
		else if (item.cursor) b.cursors[item.cursor[0]] = Math.max(b.cursors[item.cursor[0]] ?? 0, item.cursor[1])
		else return
		this.saveSoon()
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
		const approval = this.approvals.get(item.toolUseId)
		if (!approval) return
		const out = await client.daemonCall(
			this.binding.channel,
			'approvals/create',
			{ ...item.body, sessionId },
			this.abort.signal,
		)
		approval.approvalId = out.approvalId
		// Answered on one side while the approval was on its way.
		if (approval.decision)
			this.push({ kind: 'resolve', toolUseId: item.toolUseId, decision: approval.decision }, 'api', true)
		this.noteRun()
	}

	/** The approval never reached the web: the terminal's own prompt is the only one. */
	private approvalFailed(toolUseId: string): void {
		const approval = this.approvals.get(toolUseId)
		approval?.reply?.({ behavior: 'none' })
		this.approvals.delete(toolUseId)
	}

	/** Renames the session, and the task too when this session made it: its name came from the first prompt. */
	private async sendRename(sessionId: string, title: string): Promise<void> {
		const b = this.binding
		const signal = this.abort.signal
		await client.apiRpc(b.channel, 'sessions/update', { sessionId, title }, signal)
		if (b.taskMode === 'ensure' && b.taskId)
			await client.apiRpc(b.channel, 'tasks/update', { taskId: b.taskId, name: title }, signal)
	}

	/** Answers the web app's approval as the user, who answered in the terminal. */
	private async sendResolve(item: Extract<Item, { kind: 'resolve' }>): Promise<void> {
		const approvalId = this.approvals.get(item.toolUseId)?.approvalId
		if (!approvalId) return
		const body = { approvalId, decision: item.decision }
		await client.apiRpc(this.binding.channel, 'approvals/resolve', body, this.abort.signal)
		this.approvals.delete(item.toolUseId)
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
				const pick = newTask('claude', b.claudeSessionId)
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
		log(`bound ${b.claudeSessionId} to ${b.cloudSessionId}`)
		this.host.notify(`Mirroring to ${b.sessionUrl}`)
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
				warn: (_key, message) => this.host.notify(message),
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
					if (kind !== 'transient') this.host.notify(`Task diff ${kind}: ${message}`)
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
		this.host.changed()
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
		await writeJsonFileAtomic(bindingPath(b.channel, b.claudeSessionId), b).catch((err) =>
			log(`save: ${errorMessage(err)}`),
		)
	}

	private halt(reason: string): void {
		if (this.halted) return
		this.halted = reason
		log(`stopped ${this.id}: ${reason}`)
		this.closeLanes()
		for (const approval of this.approvals.values()) approval.reply?.({ behavior: 'none' })
		this.host.notify(`Mirroring stopped: ${reason}`)
		this.changed()
	}

	/** At exit: a turn still going ends as interrupted, then what is queued goes out, for up to ms. */
	shutdown(ms = FLUSH_MS): Promise<void> {
		this.closing ??= this.close(ms)
		return this.closing
	}

	private async close(ms: number): Promise<void> {
		clearTimeout(this.readTimer)
		this.stopFollowing()
		this.watcher?.close()
		this.stopRunningRepeat()
		// The transcript's last lines first, while pushes still queue.
		await Promise.race([this.read(), new Promise((r) => setTimeout(r, Math.min(ms, 1000)).unref())])
		// The terminal's open questions end with it: the web app must not offer them.
		for (const [toolUseId, approval] of this.approvals) {
			approval.reply?.({ behavior: 'none' })
			if (approval.approvalId && !approval.answeredBy)
				this.push({ kind: 'resolve', toolUseId, decision: 'deny' }, 'api', true)
		}
		if (this.settling) this.finishSettle()
		else if (this.lastStatus === 'running') this.pushStatus('interrupted')
		this.ended = true
		const end = Date.now() + ms
		await Promise.all([this.outbox.drain(ms), this.artifacts?.flush(ms), this.diff?.flush(ms)])
		const left = this.outbox.length
		// A clean exit: nothing for the next start to end. With updates left, it ends the turn instead.
		if (left === 0) this.binding.running = undefined
		await this.saveNow()
		if (left > 0) log(`${this.id}: ${left} updates not sent`)
		if (Date.now() > end) log(`${this.id}: flush ran out of time`)
		this.outbox.close()
		this.closeLanes()
		this.abort.abort()
	}
}
