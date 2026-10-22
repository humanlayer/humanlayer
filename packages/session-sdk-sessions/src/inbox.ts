// What the web app sends a mirror-only host (the opencode plugin, the Codex plugin). riptide-daemon
// learns of it from Electric shapes, and so do they, with the daemon token:
//
// - Web messages and stops, from the shape of this host's sessions: the API sets `prompt` and moves
//   the row to `resuming`, or to `interrupt_requested` for a stop. The first read holds each row's
//   past changes too, so from it the inbox takes only rows that still wait once it is in: a
//   message or stop sent while opencode was closed or reloading its plugins. Acting on a row moves
//   it on, so none replays. Every process of the agent on the machine follows the same shape, so
//   each action is claimed first (claims.ts), and runs in one process only.
// - Answers to approvals, from the shape of this host's approvals: a row moving from `pending` to
//   `approved` or `denied`. Only the process that asked holds the request, so no claim is needed.

import { createHash } from 'node:crypto'

import {
	backoffMs,
	type Channel,
	classifyRpcError,
	errorMessage,
	getChannelConfig,
	sleepUnref,
} from '@humanlayer/session-sdk-base'

import { type SessionRow, type SessionRowChange, sessionCommand } from './commands.ts'
import { type ShapeChange, ShapeReader } from './shape.ts'

/** What a follower needs of @humanlayer/session-sdk-auth's client. */
export interface DaemonTokenClient {
	withDaemonToken<T>(
		channel: Channel,
		signal: AbortSignal | undefined,
		request: (token: string) => Promise<T>,
	): Promise<T>
}

export interface FollowOptions {
	client: DaemonTokenClient
	channel: Channel
	log: (line: string) => void
	signal: AbortSignal
}

/** A shape this process follows. */
export interface Follower {
	close(): void
	/** The cloud refused the shape (a 403 or 404, say), so it gave up. A new bind starts another. */
	readonly isStopped: boolean
}

/**
 * Follows one Electric shape until closed, or until the cloud refuses it. A live request waits on
 * the server, so the next one goes out at once; failures back off.
 */
function follow<Row extends { id?: string }>(
	name: string,
	url: string,
	o: FollowOptions,
	handle: (changes: ShapeChange<Row>[], shape: ShapeReader<Row>) => Promise<void>,
): Follower {
	const stopper = new AbortController()
	const signal = AbortSignal.any([o.signal, stopper.signal])
	const shape = new ShapeReader<Row>({ url })
	const state = { stopped: false }
	void (async () => {
		let failures = 0
		while (!signal.aborted) {
			try {
				const changes = await o.client.withDaemonToken(o.channel, signal, (token) =>
					shape.poll({ 'x-daemon-authorization': token }, signal),
				)
				failures = 0
				await handle(changes, shape)
			} catch (err) {
				if (signal.aborted) return
				const action = classifyRpcError(err, 'daemon').kind
				if (action === 'stop-all' || action === 'stop-binding' || action === 'skip') {
					o.log(`${name} stopped: ${errorMessage(err)}`)
					state.stopped = true
					return
				}
				if (failures === 0) o.log(`${name}: ${errorMessage(err)}`)
				failures++
				await sleepUnref(backoffMs({}, failures), signal)
			}
		}
	})()
	return {
		close: () => stopper.abort(),
		get isStopped() {
			return state.stopped
		},
	}
}

// ---- web messages and stops ----

export interface InboxTarget {
	/** A web reply: the session moved to `resuming` with this prompt. */
	web(text: string): void
	/** The web stop button: the session moved to `interrupt_requested`. */
	stop(): void
}

/** The session columns the inbox reads. */
interface Row extends SessionRow {
	updated_at?: string | number | null
}

/** One web action on one row: the row, its new status and when it changed, and the prompt. */
export function claimKey(row: Row): string {
	const prompt = createHash('sha256')
		.update(row.prompt ?? '')
		.digest('hex')
		.slice(0, 16)
	return `${row.id}-${row.status}-${row.updated_at ?? ''}-${prompt}`
}

/** Row statuses that wait on the host: a web message or stop no one has taken yet. */
const WAITING = new Set(['resuming', 'interrupt_requested'])

export interface InboxOptions extends FollowOptions {
	hostId: string
	/** The mirror of a cloud session, if this process has one or can resume one. */
	target: (cloudSessionId: string) => Promise<InboxTarget | undefined>
	/** Takes a row change for this process, or false when another process took it first. */
	claim: (key: string) => Promise<boolean>
}

/** Follows this host's sessions for web messages and stops. */
export function followSessions(o: InboxOptions): Follower {
	let caughtUp = false
	const act = async (change: SessionRowChange<Row>) => {
		const command = sessionCommand(change)
		if (!command || (command.kind === 'continue' && !command.prompt)) return
		const target = await o.target(command.sessionId)
		if (!target || !(await o.claim(claimKey(change.value)))) return
		if (command.kind === 'continue' && command.prompt) target.web(command.prompt)
		else if (command.kind === 'interrupt') target.stop()
	}
	const url = `${getChannelConfig(o.channel).sync}/v1/sessions/${o.hostId}`
	return follow<Row>('inbox', url, o, async (changes, shape) => {
		if (!caughtUp && shape.isSeeded) {
			caughtUp = true
			const waiting = [...shape.current.values()].filter((row) => WAITING.has(row.status))
			for (const value of waiting) await act({ type: 'insert', value })
		}
		for (const change of changes) if (!change.initial) await act(change)
	})
}

// ---- approvals ----

/** The approval columns this reads. */
interface ApprovalRow {
	id: string
	session_id?: string
	status: 'pending' | 'approved' | 'denied'
	comment?: string | null
}

/** Follows this host's approvals, and hands each answer to answered(). Answers are idempotent there. */
export function followApprovals(
	o: FollowOptions & {
		/** The session too, for an answer no hook in this process waits on. */
		answered: (id: string, approved: boolean, comment: string | undefined, sessionId: string | undefined) => void
	},
): Follower {
	const url = `${getChannelConfig(o.channel).sync}/v1/daemon/approvals`
	return follow<ApprovalRow>('approvals', url, o, async (changes) => {
		for (const { value } of changes) {
			if (value.status !== 'pending')
				o.answered(
					value.id,
					value.status === 'approved',
					value.comment ?? undefined,
					value.session_id ?? undefined,
				)
		}
	})
}
