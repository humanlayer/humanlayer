import { buildConnector } from 'undici'

/** Invoked when an upstream socket errors (incl. post-response keep-alive teardown). */
export type UpstreamSocketErrorHandler = (error: unknown) => void

/**
 * undici connector that attaches an 'error' listener to every socket it opens, so an
 * async socket error (e.g. UND_ERR_SOCKET "other side closed" after the body settled) is a
 * handled, instrumented event rather than an uncaughtException. The listener is removed on
 * 'close' so nothing outlives the socket. ALPN/H2 is preserved because connectOptions are
 * passed through to undici's default buildConnector unchanged.
 */
export function makeInstrumentedConnector(opts: {
	readonly connectTimeoutMs: number
	readonly onSocketError: UpstreamSocketErrorHandler
	// Injectable for tests; defaults to undici's real connector factory. (undici is a Bun builtin
	// and cannot be vi.mock'd, so we inject rather than mock — same pattern as installUndiciDiagnostics.)
	readonly buildBaseConnector?: typeof buildConnector
}): buildConnector.connector {
	const base = (opts.buildBaseConnector ?? buildConnector)({ timeout: opts.connectTimeoutMs })
	return (connectOptions, callback) => {
		base(connectOptions, (err, socket) => {
			if (socket) {
				const handler = (error: unknown) => opts.onSocketError(error)
				socket.on('error', handler)
				socket.once('close', () => {
					socket.removeListener('error', handler)
				})
				callback(null, socket)
				return
			}
			callback(err ?? new Error('undici connect failed'), null)
		})
	}
}
