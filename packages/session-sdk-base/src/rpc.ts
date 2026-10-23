// oRPC-style HTTP calls to riptide-api, and what a session-side client does when one fails.
// Callers bring their own credentials: a bearer on the api plane, a daemon token on the daemon plane.

export type Plane = 'api' | 'daemon'

export class RpcError extends Error {
	readonly status: number
	readonly code: string | undefined
	/** The oRPC error's `data`, e.g. `validArtifacts` on a missing artifact. */
	readonly data: unknown

	constructor(message: string, status: number, code: string | undefined, data?: unknown) {
		super(message)
		this.name = 'RpcError'
		this.status = status
		this.code = code
		this.data = data
	}
}

/**
 * No bearer can be produced: no saved login, a refresh the server refused, or a refused personal
 * access token. A client pauses on this, on either plane, instead of retrying or skipping.
 */
export class LoginRequiredError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'LoginRequiredError'
	}
}

/** A timeout, cut short when `signal` aborts. */
export function timeout(ms: number, signal?: AbortSignal): AbortSignal {
	return signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms)
}

export interface RpcCall {
	/** The API origin, e.g. getChannelConfig(channel).api. */
	api: string
	plane: Plane
	path: string
	body: unknown
	/** A bearer (api plane) or raw daemon token (daemon plane). */
	cred?: string
	signal?: AbortSignal
	timeoutMs?: number
	/** Called once per call with the outcome (HTTP status or error message), time and request size. Never the body or cred. */
	onDone?: (outcome: string | number, ms: number, bytes: number) => void
}

function isErrorBody(json: unknown): json is { code?: string; message?: string; data?: unknown } {
	return typeof json === 'object' && json !== null
}

/** POST {api}/rpc/{plane}/v1/{path}. Throws RpcError on a non-2xx answer, and the fetch error on no answer. */
export async function rpcCall<T>(call: RpcCall): Promise<T> {
	const { api, plane, path, body, cred, signal, timeoutMs = 15_000, onDone } = call
	const headers = new Headers({ 'content-type': 'application/json' })
	if (cred && plane === 'api') headers.set('authorization', `Bearer ${cred}`)
	if (cred && plane === 'daemon') headers.set('x-daemon-authorization', cred)
	const data = JSON.stringify(body ?? {})
	const start = Date.now()
	const done = (outcome: string | number) => onDone?.(outcome, Date.now() - start, Buffer.byteLength(data))
	const res = await fetch(`${api}/rpc/${plane}/v1/${path}`, {
		method: 'POST',
		headers,
		body: data,
		signal: timeout(timeoutMs, signal),
	}).catch((err: unknown) => {
		done(err instanceof Error ? err.message : String(err))
		throw err
	})
	const json: unknown = await res.json().catch(() => null)
	done(res.status)
	if (!res.ok) {
		const err = isErrorBody(json) ? json : undefined
		throw new RpcError(err?.message ?? `HTTP ${res.status}`, res.status, err?.code, err?.data)
	}
	return json as T
}

export type RpcErrorAction =
	| { kind: 'retry-forever' }
	| { kind: 'retry-limited'; maxAttempts: number }
	| { kind: 'login-required' }
	| { kind: 'stop-all' }
	| { kind: 'stop-binding' }
	| { kind: 'skip' }

/** The cloud refused a daemon token: mint a new one before giving up. */
export function isTokenRefused(err: unknown): boolean {
	return err instanceof RpcError && (err.status === 401 || (err.status === 403 && err.code === 'UNAUTHORIZED'))
}

/**
 * What to do with a call that failed. A daemon-plane caller re-mints a refused token before it
 * throws, so a refusal that reaches here needs a login.
 */
export function classifyRpcError(err: unknown, plane: Plane): RpcErrorAction {
	if (err instanceof LoginRequiredError) return { kind: 'login-required' }
	if (!(err instanceof RpcError)) return { kind: 'retry-forever' } // network failure, no response
	const { status } = err
	if (status === 408 || status === 425 || status === 429 || status === 502 || status === 503 || status === 504) {
		return { kind: 'retry-forever' }
	}
	if (status === 500) return { kind: 'retry-limited', maxAttempts: 5 }
	if (plane === 'daemon' && isTokenRefused(err)) return { kind: 'login-required' }
	if (status === 402) return { kind: 'stop-all' } // any 402, not only BILLING_REQUIRED
	if (status === 403 || status === 404) return { kind: 'stop-binding' }
	return { kind: 'skip' } // 400, 413, 422 and anything else
}

/** Whether the action retries the call, forever or for a while. */
export function isRetry(action: RpcErrorAction): boolean {
	return action.kind === 'retry-forever' || action.kind === 'retry-limited'
}

/** Network failures, timeouts, 408, 425, 429 and 5xx are worth another try. */
export function isTransient(err: unknown): boolean {
	if (err instanceof LoginRequiredError) return false
	if (!(err instanceof RpcError)) return true
	return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500
}
