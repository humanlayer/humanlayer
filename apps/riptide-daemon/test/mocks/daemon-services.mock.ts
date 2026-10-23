import type { HookServices } from '../../src/agents/claudecode/types'
import { createMockORPCClient } from './orpc-client.mock'

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export function createMockHookServices(overrides?: {
	orpc?: DeepPartial<Parameters<typeof createMockORPCClient>[0]>
}): HookServices {
	return { orpc: createMockORPCClient(overrides?.orpc) }
}
