// The outbox: an ordered queue that drains itself with a session-side client's retry, backoff and
// pause rules. Open outboxes in a process share a registry: login-required pauses all of them and
// a 402 stops all of them.

import { errorMessage, sleepUnref } from './files.ts'
import { classifyRpcError, type Plane, type RpcErrorAction } from './rpc.ts'

export interface QueueItem {
	id: string
	plane: Plane
	sizeBytes: number
	/** The cap never drops this item (prepare and status updates). */
	keep?: boolean
}

/** Retry pacing: the first wait, doubling up to the max. Tests shorten it. */
export interface Backoff {
	initialBackoffMs?: number
	maxBackoffMs?: number
}

/** The wait before retry n (1 is the first). */
export function backoffMs(b: Backoff, n: number): number {
	const first = b.initialBackoffMs ?? 500
	const max = b.maxBackoffMs ?? 30_000
	return Math.min(max, first * 2 ** Math.min(n - 1, 16))
}

export interface OutboxOptions<T extends QueueItem> extends Backoff {
	send: (item: T) => Promise<void>
	onPause?: (reason: string) => void
	onResume?: () => void
	onStopAll?: (reason: string) => void
	onStopBinding?: (reason: string) => void
	onSkip?: (item: T, error: unknown) => void
	onDrop?: (item: T) => void
	/** Replaces classifyRpcError, e.g. to cap every retry on the file lane. */
	classify?: (err: unknown, plane: Plane) => RpcErrorAction
	maxItems?: number
	maxBytes?: number
	/** Where the outbox notes each failed try. */
	log?: (line: string) => void
}

/** What the registry can do to an outbox. A closure, so Outbox<T> needs no variance. */
interface Member {
	pause(reason: string): void
	resume(): void
	stop(reason: string): void
}

/** Every open outbox in this process. Stopped and closed outboxes leave it. */
const live = new Set<Member>()

/** Resumes every outbox paused for login, after a successful login. */
export function resumeAll(): void {
	for (const member of [...live]) member.resume()
}

/** Ordered FIFO queue that drains itself, applying classifyRpcError's retry, pause and stop rules. */
export class Outbox<T extends QueueItem> {
	private readonly queue: T[] = []
	private readonly opts: OutboxOptions<T>
	private byteTotal = 0
	private pauseReason: string | undefined
	private stopped = false
	private running = false
	private lastFailure: string | undefined
	private readonly member: Member = {
		pause: (reason) => this.pause(reason),
		resume: () => this.resume(),
		stop: (reason) => this.halt(reason, this.opts.onStopAll),
	}

	constructor(opts: OutboxOptions<T>) {
		this.opts = opts
		live.add(this.member)
	}

	get length(): number {
		return this.queue.length
	}

	/** What is queued, oldest first. */
	get items(): readonly T[] {
		return this.queue
	}

	/** Why the last try failed, until a send succeeds. */
	get failure(): string | undefined {
		return this.lastFailure
	}

	get isPaused(): boolean {
		return this.pauseReason !== undefined
	}

	get isStopped(): boolean {
		return this.stopped
	}

	push(item: T): void {
		if (this.stopped) return
		this.queue.push(item)
		this.byteTotal += item.sizeBytes
		this.enforceCap()
		this.kick()
	}

	private pause(reason: string): void {
		if (this.pauseReason !== undefined) return
		this.pauseReason = reason
		this.opts.onPause?.(reason)
	}

	private resume(): void {
		if (this.pauseReason === undefined) return
		this.pauseReason = undefined
		this.opts.onResume?.()
		this.kick()
	}

	/** Resolves once the queue is empty, or after ms, whichever comes first. */
	async drain(ms: number): Promise<void> {
		const waitForEmpty = (async () => {
			while (this.queue.length > 0 && !this.stopped && this.pauseReason === undefined) {
				await sleepUnref(50)
			}
		})()
		await Promise.race([waitForEmpty, sleepUnref(ms)])
	}

	/** Unregisters and drops what is left, for session shutdown. */
	close(): void {
		this.halt('closed')
	}

	/** Drops the oldest items over the cap, skipping keep items and the head (it may be in flight). */
	private enforceCap(): void {
		const maxItems = this.opts.maxItems ?? 5000
		const maxBytes = this.opts.maxBytes ?? 50 * 1024 * 1024
		let i = 1
		for (
			let item = this.queue[i];
			item && (this.queue.length > maxItems || this.byteTotal > maxBytes);
			item = this.queue[i]
		) {
			if (item.keep) {
				i++
				continue
			}
			this.queue.splice(i, 1)
			this.byteTotal -= item.sizeBytes
			this.opts.onDrop?.(item)
		}
	}

	private kick(): void {
		if (!this.running) this.runLoop().catch(() => {})
	}

	// `running` is set and cleared inside the loop, with no await in between the last check and
	// the clear, so a kick() right after the loop exits (e.g. resume after a paused push) is never lost.
	private async runLoop(): Promise<void> {
		this.running = true
		try {
			for (
				let item = this.queue[0];
				item && !this.stopped && this.pauseReason === undefined;
				item = this.queue[0]
			) {
				const done = await this.attempt(item)
				if (done && this.queue[0] === item) {
					this.queue.shift()
					this.byteTotal -= item.sizeBytes
				}
			}
		} finally {
			this.running = false
		}
	}

	/** Returns true once the item is done (sent, skipped or dropped) and should leave the queue. */
	private async attempt(item: T): Promise<boolean> {
		// Stop retrying once halted, or once paused because another outbox needs a login.
		for (let attempts = 1; !this.stopped && this.pauseReason === undefined; attempts++) {
			try {
				await this.opts.send(item)
				this.lastFailure = undefined
				return true
			} catch (err) {
				const action = (this.opts.classify ?? classifyRpcError)(err, item.plane)
				const reason = errorMessage(err)
				this.lastFailure = reason
				const note = (what: string) => this.opts.log?.(`outbox #${item.id} ${what}: ${reason}`)
				if (
					action.kind === 'retry-forever' ||
					(action.kind === 'retry-limited' && attempts <= action.maxAttempts)
				) {
					const ms = backoffMs(this.opts, attempts)
					note(`retry in ${ms}ms`)
					await sleepUnref(ms)
					continue
				}
				if (action.kind === 'login-required') {
					note('pause all for login')
					for (const member of [...live]) member.pause('login required')
					return false
				}
				if (action.kind === 'stop-all') {
					note('stop all')
					// This outbox first, so the one that met the 402 reports it first.
					this.halt(reason, this.opts.onStopAll)
					for (const member of [...live]) member.stop(reason)
					return false
				}
				if (action.kind === 'stop-binding') {
					note('stop')
					this.halt(reason, this.opts.onStopBinding)
					return false
				}
				note('skip') // also a retry-limited item out of tries
				this.opts.onSkip?.(item, err)
				return true
			}
		}
		return false
	}

	private halt(reason: string, notify?: (reason: string) => void): void {
		if (this.stopped) return
		this.stopped = true
		live.delete(this.member)
		this.queue.length = 0
		this.byteTotal = 0
		notify?.(reason)
	}
}
