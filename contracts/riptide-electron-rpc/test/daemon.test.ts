import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { describe, expect, it } from 'vitest'

import {
	DaemonInfo,
	DaemonLaunchResult,
	DaemonLifecycleEvent,
	DaemonStartError,
	DaemonStopError,
	DaemonUnavailableError,
} from '../src/desktop-rpc.js'

describe('daemon contracts', () => {
	it('accepts both daemon launch results and rejects invalid success payloads', async () => {
		const results = [
			{ type: 'daemon_ready' },
			{ type: 'daemon_already_running', message: 'Matching daemon already owns the lease' },
		] as const
		for (const result of results) {
			await expect(Effect.runPromise(Schema.decodeUnknownEffect(DaemonLaunchResult)(result))).resolves.toEqual(
				result,
			)
		}
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(DaemonLaunchResult)({ type: 'daemon_already_running' })),
		).rejects.toBeDefined()
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(DaemonLaunchResult)({ type: 'daemon_starting' })),
		).rejects.toBeDefined()
	})

	it('decodes daemon information and rejects invalid sync modes', async () => {
		const info = {
			userId: 'user-1',
			organizationId: 'org-1',
			hostId: 'host-1',
			pid: 123,
			syncMode: 'auto',
		} as const
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(DaemonInfo)(info))).resolves.toEqual(info)
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(DaemonInfo)({ ...info, syncMode: 'invalid' })),
		).rejects.toBeDefined()
	})

	it('round-trips every lifecycle event', async () => {
		const events = [
			{ _tag: 'UnexpectedExit', userId: 'user-1', organizationId: 'org-1', exitCode: 1 },
			{ _tag: 'RestartSucceeded', userId: 'user-1', organizationId: 'org-1', pid: 124 },
			{ _tag: 'RestartFailed', userId: 'user-1', organizationId: 'org-1', message: 'failed' },
			{ _tag: 'AuthenticationFailed', userId: 'user-1', organizationId: 'org-1', message: 'sign in' },
		] as const
		for (const event of events) {
			const encoded = await Effect.runPromise(Schema.encodeEffect(DaemonLifecycleEvent)(event))
			await expect(Effect.runPromise(Schema.decodeUnknownEffect(DaemonLifecycleEvent)(encoded))).resolves.toEqual(
				event,
			)
		}
	})

	it('round-trips daemon operation errors', async () => {
		const unavailable = new DaemonUnavailableError({ message: 'external mode' })
		const unavailableEncoded = await Effect.runPromise(Schema.encodeEffect(DaemonUnavailableError)(unavailable))
		await expect(
			Effect.runPromise(Schema.decodeUnknownEffect(DaemonUnavailableError)(unavailableEncoded)),
		).resolves.toEqual(unavailable)

		const start = new DaemonStartError({ message: 'spawn failed' })
		const startEncoded = await Effect.runPromise(Schema.encodeEffect(DaemonStartError)(start))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(DaemonStartError)(startEncoded))).resolves.toEqual(
			start,
		)

		const stop = new DaemonStopError({ message: 'stop failed' })
		const stopEncoded = await Effect.runPromise(Schema.encodeEffect(DaemonStopError)(stop))
		await expect(Effect.runPromise(Schema.decodeUnknownEffect(DaemonStopError)(stopEncoded))).resolves.toEqual(stop)
	})
})
