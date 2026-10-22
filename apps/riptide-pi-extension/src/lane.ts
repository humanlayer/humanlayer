// Side lanes: work that follows a bound session beside the event outbox. Task files
// (artifacts.ts), the task diff (diffs.ts), the host heartbeat (heartbeat.ts) and web messages
// (inbox.ts) are each one. The Mirror hands each lane a LaneHost; a lane never sees the Mirror.

import type { SlashCommandInfo } from '@earendil-works/pi-coding-agent'

import type { Binding } from './binding.ts'
import { guard, log } from './config.ts'
import type { Backoff } from './outbox.ts'
import { errorMessage } from './util.ts'

export interface Participant {
	/** A write or edit result (`path`, absolute) or a shell command (no path). Must not throw or wait. */
	touched?(t: { path?: string }): void
	/** At shutdown: send what is pending, for up to ms. */
	flush?(ms: number): Promise<void>
	/** Drops pending work. The binding changed, mirroring stopped, or the session ended. */
	close(): void
}

/** What a lane gets from the Mirror. The binding is bound: taskId and sessionId are set. */
export interface LaneHost {
	readonly binding: Binding
	readonly taskId: string
	readonly sessionId: string
	readonly cwd: string
	/** Aborts at the end of session_shutdown. */
	readonly signal: AbortSignal
	readonly backoff: Backoff
	/** Saves the binding file soon, after the lane changed its part of the binding. */
	save(): void
	/** Shows the file in the status line as the last one synced. */
	note(file: string): void
	/** A notice shown once per key. */
	warn(key: string, message: string): void
	/** Where web messages go, or undefined when this pi cannot take them. */
	readonly web: WebInbox | undefined
}

/** What the inbox needs from the Mirror: where web changes to the bound session go, and the skills to offer. */
export interface WebInbox {
	/** A web reply: the session moved to `resuming` with this prompt. */
	resume(prompt: string): void
	/** The web stop button: the session moved to `interrupt_requested`. */
	interrupt(): void
	/** The skills a web message can start with, as `/skill:name`. */
	skills(): SlashCommandInfo[]
}

/** Makes a lane for a bound session, or undefined when it has nothing to do. */
export type LaneFactory = (host: LaneHost) => Participant | undefined

/** The lanes running for one binding. A lane that throws is logged and left out, never fatal. */
export class Lanes {
	private readonly factories: readonly LaneFactory[]
	private running: Participant[] = []
	private binding: Binding | undefined

	constructor(factories: readonly LaneFactory[]) {
		this.factories = factories
	}

	/** The binding the lanes run for, if any. */
	get for(): Binding | undefined {
		return this.binding
	}

	/** Replaces the running lanes with a fresh set for host.binding. */
	start(host: LaneHost): void {
		this.close()
		this.binding = host.binding
		for (const make of this.factories) {
			const lane = guard('lane', () => make(host))
			if (lane) this.running.push(lane)
		}
	}

	touched(t: { path?: string }): void {
		for (const lane of this.running) guard('touched', () => lane.touched?.(t))
	}

	/** Flushes every lane at once, until the deadline `end` (epoch ms). Never rejects. */
	async flush(end: number): Promise<void> {
		const one = async (lane: Participant) => lane.flush?.(Math.max(0, end - Date.now()))
		await Promise.all(this.running.map((lane) => one(lane).catch((err) => log(`flush: ${errorMessage(err)}`))))
	}

	close(): void {
		for (const lane of this.running) guard('close', () => lane.close())
		this.running = []
		this.binding = undefined
	}
}
