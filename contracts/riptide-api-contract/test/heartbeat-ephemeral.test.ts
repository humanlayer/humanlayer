import { describe, expect, test } from 'vitest'

import { heartbeatInputSchema } from '../src/daemon/heartbeat'

const beat = { hostId: 'host-1', hostName: 'host' }

describe('heartbeat ephemeral registration signal', () => {
	test.each([true, false])('preserves ephemeral=%s', (ephemeral) => {
		expect(heartbeatInputSchema.parse({ ...beat, ephemeral })).toMatchObject({ ...beat, ephemeral })
	})

	test('accepts older daemons without the field and leaves defaulting to the API', () => {
		expect(heartbeatInputSchema.parse(beat)).toEqual(beat)
	})

	test.each([null, 'true', 1])('rejects a non-boolean ephemeral value: %s', (ephemeral) => {
		expect(heartbeatInputSchema.safeParse({ ...beat, ephemeral }).success).toBe(false)
	})
})
