// A plain-fetch reader of an Electric shape, for hosts without an Electric client. It long-polls
// the shape, keeps each row whole (an update carries only the columns that changed), and reports
// each change with the row before it. riptide-daemon reads the same shapes with @electric-sql's
// client and TanStack DB instead.

import { RpcError, timeout } from '@humanlayer/session-sdk-base'

/** One entry of an Electric shape response: a row change, or a control message. */
interface ShapeMessage<Row> {
	key?: string
	headers: { operation?: 'insert' | 'update' | 'delete'; control?: string }
	value?: Partial<Row>
}

export interface ShapeChange<Row> {
	type: 'insert' | 'update' | 'delete'
	key: string
	value: Row
	previousValue?: Row
	/** Part of the first snapshot, before the shape was first up to date: state, not news. */
	initial: boolean
}

export interface ShapeReaderOptions {
	/** The shape's URL without Electric's own parameters, e.g. `${sync}/v1/sessions/${hostId}`. */
	url: string
	/** A live request waits on the server; Electric answers after about 20 s. */
	liveTimeoutMs?: number
	fetchTimeoutMs?: number
}

export class ShapeReader<Row extends { id?: string }> {
	private readonly opts: Required<ShapeReaderOptions>
	private handle: string | undefined
	private offset = '-1'
	private cursor: string | undefined
	/** Past the first up-to-date: requests wait for changes. */
	private live = false
	/** The first snapshot is in, so later changes are news. Kept across a refetch. */
	private seeded = false
	private readonly rows = new Map<string, Row>()

	constructor(opts: ShapeReaderOptions) {
		this.opts = { liveTimeoutMs: 60_000, fetchTimeoutMs: 20_000, ...opts }
	}

	/** Past the first up-to-date: the rows below hold the snapshot and every change since. */
	get isSeeded(): boolean {
		return this.seeded
	}

	/** Each row as it stands now. */
	get current(): ReadonlyMap<string, Row> {
		return this.rows
	}

	/** One request: the changes it brought, in order. Throws RpcError on an HTTP failure. */
	async poll(headers: Record<string, string>, signal: AbortSignal): Promise<ShapeChange<Row>[]> {
		const url = new URL(this.opts.url)
		url.searchParams.set('offset', this.offset)
		if (this.handle) url.searchParams.set('handle', this.handle)
		if (this.live) {
			url.searchParams.set('live', 'true')
			if (this.cursor) url.searchParams.set('cursor', this.cursor)
		}
		const res = await fetch(url, {
			headers,
			signal: timeout(this.live ? this.opts.liveTimeoutMs : this.opts.fetchTimeoutMs, signal),
		})
		if (res.status === 409) {
			// The shape was rotated: start again from a snapshot of the new one.
			await res.body?.cancel()
			this.refetch(res.headers.get('electric-handle') ?? undefined)
			return []
		}
		if (!res.ok) {
			await res.body?.cancel()
			throw new RpcError(`shape HTTP ${res.status}`, res.status, undefined)
		}
		this.handle = res.headers.get('electric-handle') ?? this.handle
		this.offset = res.headers.get('electric-offset') ?? this.offset
		this.cursor = res.headers.get('electric-cursor') ?? this.cursor
		const messages = res.status === 204 ? [] : ((await res.json()) as ShapeMessage<Row>[])
		const changes: ShapeChange<Row>[] = []
		for (const m of messages) {
			const change = this.apply(m)
			if (change) changes.push(change)
		}
		return changes
	}

	private refetch(handle: string | undefined): void {
		this.handle = handle
		this.offset = '-1'
		this.cursor = undefined
		this.live = false
	}

	private apply(m: ShapeMessage<Row>): ShapeChange<Row> | undefined {
		const { control, operation } = m.headers
		if (control === 'up-to-date') {
			this.live = true
			this.seeded = true
			return undefined
		}
		if (control === 'must-refetch') {
			this.refetch(undefined)
			return undefined
		}
		const key = m.key ?? m.value?.id
		if (!operation || !key) return undefined
		const previousValue = this.rows.get(key)
		const value = (operation === 'insert' ? m.value : { ...previousValue, ...m.value }) as Row
		if (operation === 'delete') this.rows.delete(key)
		else this.rows.set(key, value)
		// A refetch sends every row again as an insert; one already known is an update to it.
		const type = operation === 'insert' && previousValue ? 'update' : operation
		return { type, key, value, previousValue, initial: !this.seeded }
	}
}
