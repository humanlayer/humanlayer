import { describe, expect, test } from 'vitest'

import { mapToSdkPermissionMode } from '@/agents/claudecode/permission-mode'

describe('mapToSdkPermissionMode', () => {
	test.each([
		['default', 'default'],
		['accept_edits', 'acceptEdits'],
		['bypass', 'bypassPermissions'],
		['auto', 'auto'],
	] as const)('maps %s to %s', (db, sdk) => {
		expect(mapToSdkPermissionMode(db)).toBe(sdk)
	})

	test('falls back to default for unknown / null / undefined', () => {
		expect(mapToSdkPermissionMode(null)).toBe('default')
		expect(mapToSdkPermissionMode(undefined)).toBe('default')
		expect(mapToSdkPermissionMode('totally-bogus')).toBe('default')
	})
})
