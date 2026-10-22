// The event outbox (capture.ts) and the file lane (artifacts.ts) each own one. The queue itself is
// @humanlayer/session-sdk-base's; this one logs to the extension's log file.

import { Outbox as BaseOutbox, type OutboxOptions, type QueueItem } from '@humanlayer/session-sdk-base'

import { log } from './config.ts'

export { type Backoff, backoffMs, type OutboxOptions, type QueueItem, resumeAll } from '@humanlayer/session-sdk-base'

export class Outbox<T extends QueueItem> extends BaseOutbox<T> {
	constructor(opts: OutboxOptions<T>) {
		super({ log, ...opts })
	}
}
