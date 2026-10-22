import { Context, Data, Effect, Layer } from 'effect'

import { ensureAvailablePort, ensureStackPorts } from '../lib/ports'
import type { StackAllocations } from '../sync/stack-sync.types'

export class AvailablePortsProbeError extends Data.TaggedError('AvailablePortsProbeError')<{
	readonly reason: string
	readonly cause?: unknown
}> {}

export interface AvailablePortsProbeShape {
	readonly allocate: (input: {
		readonly excludedPorts: ReadonlySet<number>
	}) => Effect.Effect<StackAllocations, AvailablePortsProbeError>
}

export class AvailablePortsProbe extends Context.Service<AvailablePortsProbe, AvailablePortsProbeShape>()(
	'devstack/AvailablePortsProbe',
) {}

export const AvailablePortsProbeLive = Layer.succeed(AvailablePortsProbe, {
	allocate: ({ excludedPorts }) =>
		Effect.tryPromise({
			try: async () => {
				const reserved = new Set(excludedPorts)
				const ports = await ensureStackPorts(undefined, reserved)
				for (const port of Object.values(ports)) reserved.add(port)
				const redisPort = await ensureAvailablePort(undefined, reserved)
				reserved.add(redisPort)
				const testRedisPort = await ensureAvailablePort(undefined, reserved)
				return {
					ports,
					redisPort,
					testRedisPort,
				}
			},
			catch: (cause) => new AvailablePortsProbeError({ reason: String(cause), cause }),
		}).pipe(Effect.withSpan('devstack.environment.probe_available_ports')),
} satisfies AvailablePortsProbeShape)
