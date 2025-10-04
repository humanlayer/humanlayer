import { type InferContractRouterInputs, oc } from '@orpc/contract'
import z from 'zod'

export const SessionSchema = z.object({
	id: z.string(),
	summary: z.string(),
	bypassPermissions: z.boolean(),
	acceptEdits: z.string(),
})

export const listSessionContract = oc
	.input(
		z.object({
			max: z.number(),
		}),
	)
	.output(
		z.object({
			count: z.number(),
			sessions: z.array(SessionSchema),
		}),
	)

/**
 * This is the core contract that the RPC router will implement.
 *
 * Example: daemonRouterContract.sessions.list's implementation will check (compile and runtime) that listSessionContract (function inputs and outputs) are met!
 */
export const daemonRouterContract = {
	sessions: {
		list: listSessionContract,
	},
}
export type DaemonRouterContractType = InferContractRouterInputs<
	typeof daemonRouterContract
>
