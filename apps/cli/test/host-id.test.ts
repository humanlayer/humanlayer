import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { getHostIdFilePath } from '../src/lib/host-id'

describe('getHostIdFilePath', () => {
	test('uses the shared host ID outside a devstack', () => {
		expect(getHostIdFilePath('/tmp/riptide', undefined)).toBe(join('/tmp/riptide', 'host_id'))
	})

	test('uses the daemon-compatible stack-scoped host ID in a devstack', () => {
		expect(getHostIdFilePath('/tmp/riptide', 'stack-one')).toBe(join('/tmp/riptide', 'host_id_stack-one'))
	})
})
