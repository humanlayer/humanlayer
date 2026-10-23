import { it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, vi } from 'vitest'

import type { ProviderLoginChangeMessage } from '@/effects/services/daemon-collections/daemon-collections.service'
import {
	makeProviderLoginHandler,
	type ProviderLoginHandlerOptions,
} from '@/effects/services/provider-login/provider-login.controller'
import type {
	ProviderLoginDriver,
	ProviderLoginDriverContext,
	ProviderLoginPatch,
} from '@/effects/services/provider-login/provider-login.types'
import { ProviderLoginAborted } from '@/effects/services/provider-login/provider-login.types'

type Update = { requestId: string } & ProviderLoginPatch

type ProviderLoginRow = ProviderLoginChangeMessage['value']

const makeRow = (overrides: Partial<ProviderLoginRow> = {}): ProviderLoginRow =>
	({
		id: 'req-1',
		organization_id: 'org-1',
		user_id: 'user-1',
		host_id: 'host-1',
		provider: 'claude',
		method: 'device',
		status: 'requested',
		url: null,
		user_code: null,
		submitted_code: null,
		error: null,
		account_label: null,
		expires_at: BigInt(Date.now() + 60_000),
		created_at: 1n,
		updated_at: 1n,
		...overrides,
	}) as ProviderLoginRow

// Let a forked login fiber observe a settled driver promise before asserting.
const settle = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 1)))

interface FakeDriver extends ProviderLoginDriver {
	readonly submitted: string[]
	readonly resolve: (accountLabel: string) => void
	readonly reject: (error: unknown) => void
	context: ProviderLoginDriverContext | null
}

function makeFakeDriver(): FakeDriver {
	let resolve: (value: { accountLabel: string }) => void = () => {}
	let reject: (error: unknown) => void = () => {}
	const result = new Promise<{ accountLabel: string }>((res, rej) => {
		resolve = res
		reject = rej
	})
	const driver: FakeDriver = {
		submitted: [],
		context: null,
		resolve: (accountLabel) => resolve({ accountLabel }),
		reject,
		submitCode: (code) => {
			driver.submitted.push(code)
		},
		start: (context) => {
			driver.context = context
			if (context.signal.aborted) reject(new ProviderLoginAborted(context.signal.reason))
			else
				context.signal.addEventListener(
					'abort',
					() => reject(new ProviderLoginAborted(context.signal.reason)),
					{
						once: true,
					},
				)
			return result
		},
	}
	return driver
}

const buildHandler = (driver: ProviderLoginDriver, overrides: Partial<ProviderLoginHandlerOptions> = {}) => {
	const updates: Update[] = []
	const release = vi.fn()
	return makeProviderLoginHandler({
		update: (input) => Effect.sync(() => void updates.push(input)),
		makeDriver: () => Effect.succeed({ driver, release }),
		...overrides,
	}).pipe(Effect.map((handler) => ({ handler, updates, release })))
}

describe('makeProviderLoginHandler', () => {
	it.effect('starts a driver for a requested row and reports success with the account label', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler, updates, release } = yield* buildHandler(driver)

				yield* handler.handle({ type: 'insert', value: makeRow() })
				yield* settle
				expect(driver.context?.requestId).toBe('req-1')

				yield* Effect.sync(() => driver.resolve('Signed in as dev@example.com'))
				yield* settle

				expect(updates.at(-1)).toEqual({
					requestId: 'req-1',
					status: 'succeeded',
					accountLabel: 'Signed in as dev@example.com',
					error: null,
					clearSubmittedCode: true,
				})
				expect(release).toHaveBeenCalledTimes(1)
			}),
		),
	)

	it.effect('delivers a submitted code once, even when the row echoes back', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow() })

				const awaiting = makeRow({
					status: 'awaiting_approval',
					url: 'https://idp/auth',
					submitted_code: 'abc',
				})
				yield* handler.handle({ type: 'update', value: awaiting })
				yield* handler.handle({ type: 'update', value: { ...awaiting, updated_at: 2n } })

				expect(driver.submitted).toEqual(['abc'])
				yield* Effect.sync(() => driver.resolve('ok'))
				yield* settle
			}),
		),
	)

	it.effect('aborts the driver when the row is cancelled and reports nothing further', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler, updates, release } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow() })
				yield* settle

				yield* handler.handle({ type: 'update', value: makeRow({ status: 'cancelled' }) })
				yield* settle

				expect(driver.context?.signal.aborted).toBe(true)
				expect(updates.some((update) => update.status === 'failed')).toBe(false)
				expect(release).toHaveBeenCalledTimes(1)
			}),
		),
	)

	it.effect('delivers the same code again after the driver cleared a rejected one', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow() })

				const awaiting = makeRow({ status: 'awaiting_approval', url: 'https://idp/auth' })
				yield* handler.handle({ type: 'update', value: { ...awaiting, submitted_code: 'abc' } })
				yield* handler.handle({ type: 'update', value: { ...awaiting, submitted_code: null, updated_at: 2n } })
				yield* handler.handle({ type: 'update', value: { ...awaiting, submitted_code: 'abc', updated_at: 3n } })

				expect(driver.submitted).toEqual(['abc', 'abc'])
				yield* Effect.sync(() => driver.resolve('ok'))
				yield* settle
			}),
		),
	)

	it.effect('drops driver progress that arrives after the row was cancelled', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler, updates } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow() })
				yield* settle

				yield* handler.handle({ type: 'update', value: makeRow({ status: 'cancelled' }) })
				yield* Effect.promise(() =>
					driver.context!.update({ status: 'awaiting_approval', url: 'https://idp/auth' }),
				)
				yield* settle

				expect(updates.some((update) => update.status === 'awaiting_approval')).toBe(false)
			}),
		),
	)

	it.effect('marks an awaiting row failed when no login is in flight for it', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const { handler, updates } = yield* buildHandler(makeFakeDriver())

				yield* handler.handle({ type: 'insert', value: makeRow({ status: 'awaiting_approval' }) })
				yield* handler.handle({
					type: 'update',
					value: makeRow({ status: 'awaiting_approval', updated_at: 2n }),
				})

				expect(updates).toEqual([
					{
						requestId: 'req-1',
						status: 'failed',
						error: 'Sign-in was interrupted because the daemon restarted. Start again.',
					},
				])
			}),
		),
	)

	it.effect('times out a login at the row expiry', () => {
		const expiresAt = BigInt(Date.now() + 5_000)
		return Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler, updates } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow({ expires_at: expiresAt }) })
				yield* settle

				yield* TestClock.adjust(Duration.millis(5_001))
				yield* settle

				expect(updates.at(-1)).toEqual({
					requestId: 'req-1',
					status: 'failed',
					error: 'Sign-in timed out. Start again when you are ready.',
					clearSubmittedCode: true,
				})
			}),
		)
	})

	it.effect('reports a driver failure message on the row', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const driver = makeFakeDriver()
				const { handler, updates } = yield* buildHandler(driver)
				yield* handler.handle({ type: 'insert', value: makeRow() })
				yield* settle

				yield* Effect.sync(() => driver.reject(new Error('Could not sign in to Claude. exit code 1')))
				yield* settle

				expect(updates.at(-1)).toEqual({
					requestId: 'req-1',
					status: 'failed',
					error: 'Could not sign in to Claude. exit code 1',
					clearSubmittedCode: true,
				})
			}),
		),
	)

	it.effect('fails an expired row without starting a driver', () => {
		const expiredAt = BigInt(Date.now() - 1)
		return Effect.scoped(
			Effect.gen(function* () {
				const makeDriver = vi.fn(() => Effect.succeed({ driver: makeFakeDriver(), release: () => {} }))
				const { handler, updates } = yield* buildHandler(makeFakeDriver(), { makeDriver })

				yield* handler.handle({ type: 'insert', value: makeRow({ expires_at: expiredAt }) })

				expect(makeDriver).not.toHaveBeenCalled()
				expect(updates).toEqual([
					{
						requestId: 'req-1',
						status: 'failed',
						error: 'Sign-in timed out. Start again when you are ready.',
					},
				])
			}),
		)
	})

	it.effect('refuses xai rows without starting a driver', () =>
		Effect.scoped(
			Effect.gen(function* () {
				const makeDriver = vi.fn(() => Effect.succeed({ driver: makeFakeDriver(), release: () => {} }))
				const { handler, updates } = yield* buildHandler(makeFakeDriver(), { makeDriver })

				yield* handler.handle({ type: 'insert', value: makeRow({ provider: 'xai' }) })

				expect(makeDriver).not.toHaveBeenCalled()
				expect(updates).toEqual([
					{ requestId: 'req-1', status: 'failed', error: 'Grok sign-in is not available yet.' },
				])
			}),
		),
	)
})
