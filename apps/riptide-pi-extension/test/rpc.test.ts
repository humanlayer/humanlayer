// Pure unit tests for classifyRpcError and Outbox, no network. Covers plan.md §9's rpc.test.ts
// bullet list: order kept under retries, 500 capped, 503 retried, a refused daemon token pauses
// for login (the call already re-minted once: auth.test.ts), 402 stops all, 413 skip, drain timeout. Also covers Step 0's bug fixes: any 402 stops all (not
// only BILLING_REQUIRED), and LoginRequiredError pauses the outbox on either plane. Log lines go to
// the harness's temp riptide home.

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test, { afterEach } from 'node:test'

import { logFilePath } from '../src/config.ts'
import { Outbox, type OutboxOptions, type QueueItem, resumeAll } from '../src/outbox.ts'
import { classifyRpcError, LoginRequiredError, type Plane, type RpcErrorAction, RpcError } from '../src/rpc.ts'
import { waitFor } from './helpers/harness.ts'

// Outboxes share a registry, so close each test's outboxes before the next test runs.
const made: Outbox<QueueItem>[] = []
afterEach(() => {
	for (const outbox of made.splice(0)) outbox.close()
})

function outboxFor(
	opts: Partial<OutboxOptions<QueueItem>> & Pick<OutboxOptions<QueueItem>, 'send'>,
): Outbox<QueueItem> {
	const outbox = new Outbox<QueueItem>({
		initialBackoffMs: 1,
		maxBackoffMs: 2,
		...opts,
	})
	made.push(outbox)
	return outbox
}

test("classifyRpcError matches plan.md §5.5's table", () => {
	const cases: Array<[status: number, code: string | undefined, plane: Plane, expected: RpcErrorAction['kind']]> = [
		[408, undefined, 'api', 'retry-forever'],
		[425, undefined, 'api', 'retry-forever'],
		[429, undefined, 'api', 'retry-forever'],
		[502, undefined, 'api', 'retry-forever'],
		[503, undefined, 'api', 'retry-forever'],
		[504, undefined, 'api', 'retry-forever'],
		[500, undefined, 'api', 'retry-limited'],
		[401, undefined, 'daemon', 'login-required'], // withDaemonToken already re-minted once
		[403, 'UNAUTHORIZED', 'daemon', 'login-required'],
		[401, undefined, 'api', 'skip'], // apiRpc refreshes and raises LoginRequiredError itself
		[402, 'BILLING_REQUIRED', 'api', 'stop-all'],
		[402, undefined, 'api', 'stop-all'], // any 402 stops all, not only BILLING_REQUIRED
		[402, 'SOME_OTHER_CODE', 'daemon', 'stop-all'],
		[403, undefined, 'api', 'stop-binding'],
		[404, undefined, 'api', 'stop-binding'],
		[400, undefined, 'api', 'skip'],
		[413, undefined, 'api', 'skip'],
		[422, undefined, 'api', 'skip'],
	]
	for (const [status, code, plane, expected] of cases) {
		const action = classifyRpcError(new RpcError('x', status, code), plane)
		assert.equal(action.kind, expected, `status ${status} code ${code ?? '-'} plane ${plane}`)
	}
	assert.equal(classifyRpcError(new Error('network down'), 'api').kind, 'retry-forever')
})

test('classifyRpcError treats LoginRequiredError as login-required on either plane', () => {
	assert.equal(classifyRpcError(new LoginRequiredError('x'), 'api').kind, 'login-required')
	assert.equal(classifyRpcError(new LoginRequiredError('x'), 'daemon').kind, 'login-required')
})

test('Outbox keeps FIFO order across a retried item', async () => {
	const sent: string[] = []
	let firstAttempt = true
	const outbox = outboxFor({
		send: async (item) => {
			if (item.id === 'a' && firstAttempt) {
				firstAttempt = false
				throw new Error('transient') // not an RpcError -> retry-forever
			}
			sent.push(item.id)
		},
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })
	outbox.push({ id: 'b', plane: 'api', sizeBytes: 1 })
	outbox.push({ id: 'c', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)
	assert.deepEqual(sent, ['a', 'b', 'c'])
})

test('Outbox caps HTTP 500 retries, then skips the item', async () => {
	let sends = 0
	const skipped: unknown[] = []
	const outbox = outboxFor({
		send: async () => {
			sends++
			throw new RpcError('server error', 500, undefined)
		},
		onSkip: (_item, err) => skipped.push(err),
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)
	// maxAttempts: 5 retries while attempts <= 5, i.e. the original send plus 5 retries.
	assert.equal(sends, 6)
	assert.equal(skipped.length, 1)
	assert.equal(outbox.length, 0)
})

test('Outbox retries HTTP 503 well past the 500 cap, until it succeeds', async () => {
	let attempts = 0
	const outbox = outboxFor({
		send: async () => {
			attempts++
			if (attempts < 20) throw new RpcError('unavailable', 503, undefined)
		},
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)
	assert.equal(attempts, 20)
	assert.equal(outbox.length, 0)
})

test('Outbox takes a classify override: the file lane caps a 503 it would otherwise retry forever', async () => {
	let sends = 0
	const skipped: unknown[] = []
	const outbox = outboxFor({
		send: async () => {
			sends++
			throw new RpcError('unavailable', 503, undefined)
		},
		classify: () => ({ kind: 'retry-limited', maxAttempts: 2 }),
		onSkip: (_item, err) => skipped.push(err),
	})
	outbox.push({ id: 'a', plane: 'daemon', sizeBytes: 1 })
	await outbox.drain(2000)
	assert.equal(sends, 3)
	assert.equal(skipped.length, 1)
	assert.equal(outbox.length, 0)
})

test("Outbox pauses as 'login required' when the daemon token is still refused", async () => {
	const paused: string[] = []
	const outbox = outboxFor({
		send: async () => {
			throw new RpcError('unauthorized', 401, undefined)
		},
		onPause: (reason) => paused.push(reason),
	})
	outbox.push({ id: 'a', plane: 'daemon', sizeBytes: 1 })
	await outbox.drain(2000)
	assert.deepEqual(paused, ['login required'])
	assert.equal(outbox.isPaused, true)
	assert.equal(outbox.length, 1) // the item stays queued, waiting for resume()
})

test("Outbox pauses as 'login required' on a LoginRequiredError from an API-plane item (e.g. prepare), without retrying", async () => {
	const paused: string[] = []
	let sends = 0
	const outbox = outboxFor({
		send: async () => {
			sends++
			throw new LoginRequiredError('not signed in')
		},
		onPause: (reason) => paused.push(reason),
	})
	outbox.push({ id: 'prepare', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)

	assert.deepEqual(paused, ['login required'])
	assert.equal(outbox.isPaused, true)
	assert.equal(sends, 1) // no retry
	assert.equal(outbox.length, 1) // stays queued, waiting for resume()
})

test('Outbox stops all mirroring on 402 BILLING_REQUIRED and drops later pushes', async () => {
	let stopReason: string | undefined
	const outbox = outboxFor({
		send: async () => {
			throw new RpcError('payment required', 402, 'BILLING_REQUIRED')
		},
		onStopAll: (reason) => {
			stopReason = reason
		},
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })
	outbox.push({ id: 'b', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)

	assert.equal(outbox.isStopped, true)
	assert.equal(outbox.length, 0)
	assert.ok(stopReason?.includes('payment required'))

	outbox.push({ id: 'c', plane: 'api', sizeBytes: 1 })
	assert.equal(outbox.length, 0) // a stopped outbox drops new pushes
})

test('Outbox stops all mirroring on a 402 with no code, not only BILLING_REQUIRED', async () => {
	let stopReason: string | undefined
	const outbox = outboxFor({
		send: async () => {
			throw new RpcError('payment required', 402, undefined)
		},
		onStopAll: (reason) => {
			stopReason = reason
		},
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)

	assert.equal(outbox.isStopped, true)
	assert.ok(stopReason?.includes('payment required'))
})

test('Outbox skips a single item on 413 without touching the rest of the queue', async () => {
	const sent: string[] = []
	const skipped: string[] = []
	const outbox = outboxFor({
		send: async (item) => {
			if (item.id === 'big') throw new RpcError('too large', 413, undefined)
			sent.push(item.id)
		},
		onSkip: (item) => skipped.push(item.id),
	})
	outbox.push({ id: 'big', plane: 'api', sizeBytes: 1 })
	outbox.push({ id: 'small', plane: 'api', sizeBytes: 1 })
	await outbox.drain(2000)
	assert.deepEqual(skipped, ['big'])
	assert.deepEqual(sent, ['small'])
})

test('Outbox.drain resolves at its timeout even when the queue is still stuck retrying', async () => {
	const outbox = outboxFor({
		initialBackoffMs: 10_000, // long enough that this test's drain() times out first
		send: async () => {
			throw new RpcError('unavailable', 503, undefined)
		},
	})
	outbox.push({ id: 'a', plane: 'api', sizeBytes: 1 })

	const start = Date.now()
	await outbox.drain(50)
	const elapsed = Date.now() - start

	assert.ok(elapsed < 1000, `drain should return promptly, took ${elapsed}ms`)
	assert.equal(outbox.length, 1) // drain gave up waiting; the item is still queued
})

test('login-required on one outbox pauses every open outbox, and resumeAll resumes them', async () => {
	let signedIn = false
	const sent: string[] = []
	const a = outboxFor({
		send: async (item) => {
			if (!signedIn) throw new LoginRequiredError('not signed in')
			sent.push(item.id)
		},
	})
	const b = outboxFor({ send: async (item) => void sent.push(item.id) })
	a.push({ id: 'a1', plane: 'api', sizeBytes: 1 })
	await a.drain(2000)
	assert.equal(a.isPaused, true)
	assert.equal(b.isPaused, true)
	b.push({ id: 'b1', plane: 'daemon', sizeBytes: 1 })
	assert.equal(b.length, 1) // held while paused

	signedIn = true
	resumeAll()
	await Promise.all([a.drain(2000), b.drain(2000)])
	assert.deepEqual(sent.sort(), ['a1', 'b1'])
	assert.equal(a.isPaused || b.isPaused, false)
})

test('a 402 on one outbox stops every open outbox, while a 403 stops only its own', async () => {
	const stops: string[] = []
	const failing = (status: number) =>
		outboxFor({
			send: async () => {
				throw new RpcError(`HTTP ${status}`, status, 'FORBIDDEN')
			},
			onStopAll: () => stops.push(`all ${status}`),
			onStopBinding: () => stops.push(`binding ${status}`),
		})
	const forbidden = failing(403)
	const other = outboxFor({ send: async () => {}, onStopAll: () => stops.push('all other') })
	forbidden.push({ id: 'a', plane: 'daemon', sizeBytes: 1 })
	await forbidden.drain(2000)
	assert.equal(forbidden.isStopped, true)
	assert.equal(other.isStopped, false)

	const billing = failing(402)
	billing.push({ id: 'b', plane: 'daemon', sizeBytes: 1 })
	await billing.drain(2000)
	assert.equal(other.isStopped, true)
	// The 403 outbox had already left the registry, so the 402 did not reach it.
	assert.deepEqual(stops, ['binding 403', 'all 402', 'all other'])
	assert.equal(outboxFor({ send: async () => {} }).isStopped, false) // new outboxes start fresh
})

test('the outbox logs each retry, skip, pause and stop with its reason', async () => {
	const errors: Record<string, Error[]> = {
		retry: [new RpcError('busy', 503, undefined)],
		skip: [new RpcError('too large', 413, undefined)],
		stop: [new RpcError('gone', 404, undefined)],
		all: [new RpcError('payment required', 402, undefined)],
		login: [new LoginRequiredError('not signed in')],
	}
	for (const id of Object.keys(errors)) {
		const outbox = outboxFor({
			send: async (item) => {
				const err = errors[item.id]?.shift()
				if (err) throw err
			},
		})
		outbox.push({ id, plane: 'api', sizeBytes: 1 })
		await outbox.drain(2000)
	}
	const lines = [
		'#retry retry in 1ms: busy',
		'#skip skip: too large',
		'#stop stop: gone',
		'#all stop all: payment required',
	]
	lines.push('#login pause all for login: not signed in')
	await waitFor('a line for each', async () => {
		const text = await readFile(logFilePath(), 'utf8').catch(() => '')
		return lines.every((line) => text.includes(` outbox ${line}\n`))
	})
})

test('the cap drops the oldest items, but never the in-flight head or keep items', async () => {
	const dropped: string[] = []
	const sent: string[] = []
	let release = () => {}
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const outbox = outboxFor({
		maxItems: 3,
		send: async (item) => {
			await gate
			sent.push(item.id)
		},
		onDrop: (item) => dropped.push(item.id),
	})
	outbox.push({ id: 'head', plane: 'daemon', sizeBytes: 1 })
	outbox.push({ id: 'status', plane: 'daemon', sizeBytes: 1, keep: true })
	for (const id of ['e1', 'e2', 'e3']) outbox.push({ id, plane: 'daemon', sizeBytes: 1 })
	assert.deepEqual(dropped, ['e1', 'e2'])

	release()
	await outbox.drain(2000)
	assert.deepEqual(sent, ['head', 'status', 'e3'])
})
