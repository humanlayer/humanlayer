import { describe, expect, it } from '@effect/vitest'
import * as Effect from 'effect/Effect'

import { terminatePty } from '../src/pty/pty-signaling'

describe('PTY signaling', () => {
	it.effect('always follows group TERM with group KILL', () =>
		Effect.gen(function* () {
			const calls: Array<string> = []
			yield* terminatePty({
				ptyId: 'pty-1',
				operation: 'kill',
				signalProcessGroup: (signal) => calls.push(`group:${signal}`),
				signalPty: (signal) => calls.push(`pty:${signal}`),
			})
			expect(calls).toEqual(['group:SIGTERM', 'group:SIGKILL'])
		}),
	)

	it.effect('falls back to node-pty and retains every failed attempt', () =>
		Effect.gen(function* () {
			const calls: Array<string> = []
			const error = yield* Effect.flip(
				terminatePty({
					ptyId: 'pty-2',
					operation: 'shutdown',
					signalProcessGroup: (signal) => {
						calls.push(`group:${signal}`)
						throw new Error(`${signal} failed`)
					},
					signalPty: (signal) => {
						calls.push(`pty:${signal}`)
						throw new Error('direct failed')
					},
				}),
			)
			expect(calls).toEqual(['group:SIGTERM', 'group:SIGKILL', 'pty:SIGKILL'])
			expect(error._tag).toBe('PtyTerminationError')
			expect(error.attempts).toHaveLength(3)
		}),
	)

	it.effect('treats ESRCH as successful termination', () =>
		Effect.gen(function* () {
			const calls: Array<string> = []
			yield* terminatePty({
				ptyId: 'pty-gone',
				operation: 'kill',
				signalProcessGroup: (signal) => {
					calls.push(signal)
					throw Object.assign(new Error('gone'), { code: 'ESRCH' })
				},
				signalPty: (signal) => calls.push(signal),
			})
			expect(calls).toEqual(['SIGTERM'])
		}),
	)
})
