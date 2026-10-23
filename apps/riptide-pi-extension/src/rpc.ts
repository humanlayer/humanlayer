// HTTP calls to riptide-api for a channel, logged to the extension's log file. The call itself
// and its error rules are @humanlayer/session-sdk-base's. auth.ts adds the tokens.

import { client } from './auth.ts'

export {
	classifyRpcError,
	isRetry,
	isTokenRefused,
	LoginRequiredError,
	type Plane,
	RpcError,
	type RpcErrorAction,
	timeout,
} from '@humanlayer/session-sdk-base'

/**
 * POST {api}/rpc/{plane}/v1/{path}. `cred` is a bearer (api plane) or raw daemon token (daemon
 * plane). Logs one line per call: the outcome, time and request size, never the body or cred.
 */
export const rpc = client.rpc
