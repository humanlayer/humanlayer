import { describe, expect, test } from 'vitest'

import { daemonSupports } from './daemon-version'

describe('daemonSupports', () => {
	test.each([
		['0.31.173-dev.0', 'cli', 'unsupported'],
		['0.31.182-dev.0', null, 'unsupported'],
		['0.31.183-dev.0', null, 'supported'],
		['0.31.183-beta.0', 'cli', 'supported'],
		['0.31.183', 'cli', 'supported'],
		['0.32.0', 'cli', 'supported'],
		['0.178.0', 'desktop', 'unknown'],
		['dev', 'cli', 'unknown'],
		[null, null, 'unsupported'],
	] as const)(
		'%s from %s without a capability list is %s for provider login',
		(daemonVersion, distribution, expected) => {
			expect(
				daemonSupports({ daemon_version: daemonVersion, distribution, capabilities: null }, 'providerLogin'),
			).toBe(expected)
		},
	)

	test.each([
		['0.31.165-dev.0', 'unsupported'],
		['0.31.166-dev.0', 'supported'],
	] as const)('%s without a capability list is %s for repository reporting', (daemonVersion, expected) => {
		expect(
			daemonSupports(
				{ daemon_version: daemonVersion, distribution: 'cli', capabilities: null },
				'reportsRepositories',
			),
		).toBe(expected)
	})

	test.each([
		[['reportsRepositories', 'providerLogin'], 'supported'],
		[['reportsRepositories'], 'unsupported'],
		[[], 'unsupported'],
	])('a capability list %j is %s for provider login, whatever the version says', (capabilities, expected) => {
		expect(daemonSupports({ daemon_version: 'dev', distribution: 'desktop', capabilities }, 'providerLogin')).toBe(
			expected,
		)
	})
})
