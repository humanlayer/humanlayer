import { describe, expect, test } from 'vitest'

import {
	getHostUpdateState,
	hasOldSelfUpdater,
	type HostUpdateFields,
	isHostUpdatable,
	isUpdateStalled,
} from '@/lib/host-update'

const LATEST = '0.31.4'
const NOW = 1_800_000_000_000

function host(overrides: Partial<HostUpdateFields> = {}): HostUpdateFields {
	return {
		daemon_version: LATEST,
		distribution: 'cli',
		can_self_update: true,
		update_state: null,
		...overrides,
	}
}

describe('isHostUpdatable', () => {
	test('is true only for a cli daemon that claims the capability', () => {
		expect(isHostUpdatable({ distribution: 'cli', can_self_update: true })).toBe(true)
		expect(isHostUpdatable({ distribution: 'cli', can_self_update: false })).toBe(false)
		expect(isHostUpdatable({ distribution: 'cli', can_self_update: null })).toBe(false)
		expect(isHostUpdatable({ distribution: 'desktop', can_self_update: true })).toBe(false)
		expect(isHostUpdatable({ distribution: null, can_self_update: true })).toBe(false)
	})
})

describe('isUpdateStalled', () => {
	test('is true once an installing host has not heartbeated for 5 minutes', () => {
		expect(isUpdateStalled({ update_state: 'installing', last_seen: BigInt(NOW - 299_999) }, NOW)).toBe(false)
		expect(isUpdateStalled({ update_state: 'installing', last_seen: BigInt(NOW - 300_000) }, NOW)).toBe(true)
		expect(isUpdateStalled({ update_state: 'requested', last_seen: BigInt(NOW - 300_000) }, NOW)).toBe(false)
	})
})

describe('hasOldSelfUpdater', () => {
	const cli = { distribution: 'cli', can_self_update: true, daemon_version: '0.31.201' } as const

	test('is true for an updatable daemon that does not report restarting after a self-update', () => {
		expect(hasOldSelfUpdater({ ...cli, capabilities: ['reportsRepositories', 'providerLogin'] })).toBe(true)
		expect(hasOldSelfUpdater({ ...cli, capabilities: null })).toBe(true)
	})

	test('is false once the daemon reports it, or when the app cannot update the daemon', () => {
		expect(hasOldSelfUpdater({ ...cli, capabilities: ['restartsAfterSelfUpdate'] })).toBe(false)
		expect(hasOldSelfUpdater({ ...cli, can_self_update: false, capabilities: [] })).toBe(false)
		expect(hasOldSelfUpdater({ ...cli, distribution: 'desktop', capabilities: [] })).toBe(false)
	})
})

describe('getHostUpdateState', () => {
	test('compares the daemon version with the latest daemon version', () => {
		expect(getHostUpdateState(host({ daemon_version: '0.30.0' }), LATEST)).toBe('outdated')
		expect(getHostUpdateState(host({ daemon_version: LATEST }), LATEST)).toBe('current')
		expect(getHostUpdateState(host({ daemon_version: '0.32.0' }), LATEST)).toBe('current')
	})

	test('orders prereleases by semver precedence', () => {
		expect(getHostUpdateState(host({ daemon_version: '0.31.173-dev.0' }), '0.31.100')).toBe('current')
		expect(getHostUpdateState(host({ daemon_version: '0.31.100-dev.0' }), '0.31.100')).toBe('outdated')
	})

	test('compares a v-prefixed version only when the daemon was installed through the cli', () => {
		expect(getHostUpdateState(host({ daemon_version: 'v0.30.0' }), LATEST)).toBe('outdated')
		expect(getHostUpdateState(host({ distribution: 'desktop', daemon_version: 'v0.177.0' }), LATEST)).toBe(
			'unknown',
		)
	})

	test('is unknown when either version cannot be read', () => {
		expect(getHostUpdateState(host({ daemon_version: 'dev' }), LATEST)).toBe('unknown')
		expect(getHostUpdateState(host({ daemon_version: null }), LATEST)).toBe('unknown')
		expect(getHostUpdateState(host(), null)).toBe('unknown')
	})

	test('is unknown for a desktop daemon, whose version series is the app release', () => {
		expect(getHostUpdateState(host({ distribution: 'desktop', daemon_version: '0.1.0' }), LATEST)).toBe('unknown')
	})

	test('reports the stored update state ahead of the comparison', () => {
		expect(getHostUpdateState(host({ daemon_version: '0.30.0', update_state: 'requested' }), LATEST)).toBe(
			'requested',
		)
		expect(getHostUpdateState(host({ daemon_version: '0.30.0', update_state: 'installing' }), LATEST)).toBe(
			'installing',
		)
		expect(getHostUpdateState(host({ daemon_version: '0.30.0', update_state: 'failed' }), LATEST)).toBe('failed')
		expect(getHostUpdateState(host({ daemon_version: 'dev', update_state: 'failed' }), LATEST)).toBe('failed')
	})

	test('compares a daemon that never reported a distribution', () => {
		expect(getHostUpdateState(host({ distribution: null, daemon_version: '0.30.0' }), LATEST)).toBe('outdated')
	})
})
