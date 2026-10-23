import { describe, expect, it } from 'vitest'

import { isRecoveredSocketUncaught } from '../../src/lib/effect/sentry.service'

// isRecoveredSocketUncaught drops ONLY uncaughtException/unhandledRejection-mechanism benign socket
// teardowns (recovered by the L1 socket listener + index.ts backstop) so they don't ship as fatal.
// Genuine crashes and our handled L1 warnings must still pass through.
describe('isRecoveredSocketUncaught', () => {
	it('drops an uncaughtException SocketError ("other side closed")', () => {
		const event = {
			exception: {
				values: [
					{ type: 'SocketError', value: 'other side closed', mechanism: { type: 'onuncaughtexception' } },
				],
			},
		}
		expect(isRecoveredSocketUncaught(event as never)).toBe(true)
	})

	it('drops a benign code surfaced via contexts (extraErrorDataIntegration)', () => {
		const event = {
			exception: { values: [{ type: 'Error', value: 'boom', mechanism: { type: 'onuncaughtexception' } }] },
			contexts: { Error: { code: 'ECONNRESET' } },
		}
		expect(isRecoveredSocketUncaught(event as never)).toBe(true)
	})

	it('keeps a HANDLED SocketError warning (not an uncaught mechanism)', () => {
		const event = {
			exception: {
				values: [
					{ type: 'SocketError', value: 'other side closed', mechanism: { type: 'generic', handled: true } },
				],
			},
		}
		expect(isRecoveredSocketUncaught(event as never)).toBe(false)
	})

	it('keeps a genuine fatal uncaughtException (non-socket)', () => {
		const event = {
			exception: {
				values: [
					{ type: 'TypeError', value: 'x is not a function', mechanism: { type: 'onuncaughtexception' } },
				],
			},
		}
		expect(isRecoveredSocketUncaught(event as never)).toBe(false)
	})

	it('returns false when there is no exception', () => {
		expect(isRecoveredSocketUncaught({} as never)).toBe(false)
	})
})
