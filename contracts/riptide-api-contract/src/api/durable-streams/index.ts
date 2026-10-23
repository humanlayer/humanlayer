import { getOrHydrateDurableStreamSessionsContract } from './sessions'

export const durableStreamsContract = {
	sessions: {
		getOrHydrate: getOrHydrateDurableStreamSessionsContract,
	},
}
