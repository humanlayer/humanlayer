import { describe, expect, test } from 'vitest'

import { heartbeatInputSchema } from '../src/daemon/heartbeat'

const beat = { hostId: 'host-1', hostName: 'host', daemonVersion: '1.2.3' }
const claude = {
	checked_at: 1_700_000_000_000,
	available: true,
	subscription_type: 'max',
	windows: { five_hour: { used_percent: 42, resets_at: 1_700_000_500_000, status: 'allowed' } },
}

describe('heartbeat usage limits', () => {
	test('keeps a valid usage record', () => {
		expect(
			heartbeatInputSchema.parse({ ...beat, codingAgentUsageLimits: { claude } }).codingAgentUsageLimits,
		).toEqual({
			claude,
		})
	})

	test.each([
		[
			'a status this API does not know',
			{
				claude: {
					...claude,
					windows: { five_hour: { used_percent: 100, resets_at: null, status: 'blocked' } },
				},
			},
		],
		[
			'a negative percent',
			{ claude: { ...claude, windows: { five_hour: { used_percent: -1, resets_at: null } } } },
		],
		['no windows', { claude: { ...claude, windows: undefined } }],
		['a null record', null],
		['a string', 'garbage'],
	])('accepts the beat and drops usage with %s', (_name, codingAgentUsageLimits) => {
		const parsed = heartbeatInputSchema.safeParse({ ...beat, codingAgentUsageLimits })
		expect(parsed.success).toBe(true)
		expect(parsed.data).toMatchObject(beat)
		expect(parsed.data?.codingAgentUsageLimits).toBeUndefined()
	})
})
