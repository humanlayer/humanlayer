import { describe, expect, test } from 'vitest'

import { deriveGitHubStatus } from './github.status'

const connection = (status: 'active' | 'suspended') => ({ status })

describe('deriveGitHubStatus', () => {
	test('an organization that never installed the App is not connected, whatever the switch says', () => {
		expect(deriveGitHubStatus({ enabled: false, connections: [] })).toBe('not_connected')
		expect(deriveGitHubStatus({ enabled: true, connections: [] })).toBe('not_connected')
	})

	test('an installation switched off in settings is disabled', () => {
		expect(deriveGitHubStatus({ enabled: false, connections: [connection('active')] })).toBe('disabled')
	})

	test('an active installation with the switch on is connected', () => {
		expect(deriveGitHubStatus({ enabled: true, connections: [connection('active')] })).toBe('connected')
	})

	test('a suspended installation alone is not connected', () => {
		expect(deriveGitHubStatus({ enabled: true, connections: [connection('suspended')] })).toBe('not_connected')
	})
})
