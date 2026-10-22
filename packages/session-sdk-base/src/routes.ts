// riptide-api's routes, keyed by their URL path (`sessions/events/create`), with the request and
// response types of its own contract. Type-only: nothing here exists at runtime.

import type {
	RiptideApiContract,
	RiptideApiInputs,
	RiptideApiOutputs,
	RiptideDaemonApiContract,
	RiptideDaemonApiInputs,
} from '@humanlayer/riptide-api-contract/contract-router'
import type { InferContractRouterOutputs } from '@orpc/contract'

type DaemonContract = typeof RiptideDaemonApiContract
type DaemonOutputs = InferContractRouterOutputs<DaemonContract>

/** A procedure, as opposed to a group of them. */
type Procedure = { '~orpc': unknown }

type PathsOf<R, Prefix extends string = ''> = {
	[K in keyof R & string]: R[K] extends Procedure ? `${Prefix}${K}` : PathsOf<R[K], `${Prefix}${K}/`>
}[keyof R & string]

type At<T, Path extends string> = Path extends `${infer Head}/${infer Rest}`
	? Head extends keyof T
		? At<T[Head], Rest>
		: never
	: Path extends keyof T
		? T[Path]
		: never

/** Every daemon route, as the path after `/rpc/daemon/v1/`. */
export type DaemonPath = PathsOf<DaemonContract>
export type DaemonRequest<P extends DaemonPath> = At<RiptideDaemonApiInputs, P>
export type DaemonResponse<P extends DaemonPath> = At<DaemonOutputs, P>

/** Every api-plane route, as the path after `/rpc/api/v1/`. They take a user's bearer. */
export type ApiPath = PathsOf<typeof RiptideApiContract>
export type ApiRequest<P extends ApiPath> = At<RiptideApiInputs, P>
export type ApiResponse<P extends ApiPath> = At<RiptideApiOutputs, P>
