import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { makeInstrumentedConnector } from '../../src/lib/effect/instrumented-connector'

// undici is a Bun builtin and cannot be vi.mock'd, so we inject a fake base connector via
// `buildBaseConnector` and drive 'error'/'close' on a controllable mock socket deterministically.
type BaseCallback = (err: Error | null, socket: unknown) => void

function makeMockSocket(): EventEmitter {
	return new EventEmitter()
}

describe('makeInstrumentedConnector', () => {
	it('forwards an async socket error to onSocketError', () => {
		const socket = makeMockSocket()
		const baseConnector = vi.fn((_opts: unknown, cb: BaseCallback) => cb(null, socket))
		const buildBaseConnector = vi.fn(() => baseConnector)
		const onSocketError = vi.fn()

		const connector = makeInstrumentedConnector({
			connectTimeoutMs: 10_000,
			onSocketError,
			buildBaseConnector: buildBaseConnector as never,
		})
		connector({ hostname: 'electric.test', protocol: 'https:', port: '443' } as never, () => {})

		const error = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
		socket.emit('error', error)
		expect(onSocketError).toHaveBeenCalledWith(error)
	})

	it("removes the error listener on 'close' so nothing outlives the socket", () => {
		const socket = makeMockSocket()
		const baseConnector = vi.fn((_opts: unknown, cb: BaseCallback) => cb(null, socket))
		const buildBaseConnector = vi.fn(() => baseConnector)
		const onSocketError = vi.fn()

		const connector = makeInstrumentedConnector({
			connectTimeoutMs: 10_000,
			onSocketError,
			buildBaseConnector: buildBaseConnector as never,
		})
		connector({ hostname: 'electric.test', protocol: 'https:', port: '443' } as never, () => {})

		// The listener exists while the socket lives, and is gone after 'close' (no leak).
		expect(socket.listenerCount('error')).toBe(1)
		socket.emit('close')
		expect(socket.listenerCount('error')).toBe(0)
	})

	it('builds the base connector with the timeout and forwards connectOptions unchanged (ALPN/H2 preserved)', () => {
		const socket = makeMockSocket()
		const baseConnector = vi.fn((_opts: unknown, cb: BaseCallback) => cb(null, socket))
		const buildBaseConnector = vi.fn(() => baseConnector)
		const onSocketError = vi.fn()
		const callback = vi.fn()

		const connector = makeInstrumentedConnector({
			connectTimeoutMs: 7_000,
			onSocketError,
			buildBaseConnector: buildBaseConnector as never,
		})
		expect(buildBaseConnector).toHaveBeenCalledWith({ timeout: 7_000 })

		const connectOptions = {
			hostname: 'electric.test',
			protocol: 'https:',
			port: '443',
			ALPNProtocols: ['h2', 'http/1.1'],
		}
		connector(connectOptions as never, callback as never)

		// The exact same connectOptions object identity is forwarded — undici controls ALPN/H2 here.
		expect(baseConnector).toHaveBeenCalledTimes(1)
		expect(baseConnector.mock.calls[0]?.[0]).toBe(connectOptions)
		expect(callback).toHaveBeenCalledWith(null, socket)
	})

	it('forwards a connect error (no socket) without attaching listeners', () => {
		const onSocketError = vi.fn()
		const callback = vi.fn()
		const connectError = new Error('connect refused')
		const baseConnector = vi.fn((_opts: unknown, cb: BaseCallback) => cb(connectError, null))
		const buildBaseConnector = vi.fn(() => baseConnector)

		const connector = makeInstrumentedConnector({
			connectTimeoutMs: 10_000,
			onSocketError,
			buildBaseConnector: buildBaseConnector as never,
		})
		connector({ hostname: 'electric.test', protocol: 'https:', port: '443' } as never, callback as never)

		expect(callback).toHaveBeenCalledWith(connectError, null)
		expect(onSocketError).not.toHaveBeenCalled()
	})
})
