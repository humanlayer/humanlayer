import { describe, expect, test } from 'vitest'

import { pickPreferredHostId, type PreferredHostInput } from './use-effective-host'

const LOCAL = 'host-local'
const REMOTE = 'host-remote'
const OTHER = 'host-other'

const NOW_MS = 1_800_000_000_000
const FRESH = BigInt(NOW_MS - 5_000)
const STALE = BigInt(NOW_MS - 60_000)

function pick(overrides: Partial<PreferredHostInput>) {
	return pickPreferredHostId({
		hosts: [
			{ host_id: OTHER, status: 'online', last_seen: FRESH },
			{ host_id: REMOTE, status: 'offline', last_seen: STALE },
			{ host_id: LOCAL, status: 'offline', last_seen: STALE },
		],
		userSelectedHostId: null,
		lastUsedHostId: null,
		localHostId: LOCAL,
		localDaemonStarting: false,
		nowMs: NOW_MS,
		...overrides,
	})
}

describe('pickPreferredHostId', () => {
	test('mirror-only hosts cannot win explicit, remembered, or online fallback selection', () => {
		const hosts = [
			{ host_id: REMOTE, status: 'online' as const, last_seen: FRESH, capabilities: ['attachedSessionsOnly'] },
			{ host_id: OTHER, status: 'online' as const, last_seen: FRESH, capabilities: null },
		]
		expect(pick({ hosts, userSelectedHostId: REMOTE, localHostId: null })).toBe(OTHER)
		expect(pick({ hosts, lastUsedHostId: REMOTE, localHostId: null })).toBe(OTHER)
		expect(pick({ hosts, localHostId: null })).toBe(OTHER)
	})

	test('a known mirror-only local host does not become a synthetic starting host', () => {
		const hosts = [
			{ host_id: LOCAL, status: 'offline' as const, last_seen: STALE, capabilities: ['attachedSessionsOnly'] },
			{ host_id: OTHER, status: 'online' as const, last_seen: FRESH, capabilities: null },
		]
		expect(pick({ hosts, localDaemonStarting: true })).toBe(OTHER)
		expect(pick({ hosts, localDaemonStarting: false })).toBe(OTHER)
	})

	test('an explicit selection wins when the host exists, whatever its status', () => {
		expect(pick({ userSelectedHostId: REMOTE, lastUsedHostId: OTHER })).toBe(REMOTE)
	})

	test('an explicit selection of an unknown host falls through', () => {
		expect(pick({ userSelectedHostId: 'gone', lastUsedHostId: REMOTE })).toBe(REMOTE)
	})

	test('the last-used host comes next, even when it is offline', () => {
		expect(pick({ lastUsedHostId: REMOTE })).toBe(REMOTE)
	})

	test('a last-used host that no longer exists falls through to this device', () => {
		expect(pick({ lastUsedHostId: 'gone' })).toBe(LOCAL)
	})

	test('this device comes before an online host when it has a row', () => {
		expect(pick({})).toBe(LOCAL)
	})

	test('this device with no row yet is picked only while its daemon starts', () => {
		const hosts = [{ host_id: OTHER, status: 'online' as const, last_seen: FRESH }]
		expect(pick({ hosts, localDaemonStarting: true })).toBe(LOCAL)
		expect(pick({ hosts, localDaemonStarting: false })).toBe(OTHER)
	})

	test('the first online host is the fallback outside the desktop app', () => {
		expect(pick({ localHostId: null })).toBe(OTHER)
	})

	test('the fallback skips a host that still says online but stopped sending heartbeats', () => {
		const hosts = [
			{ host_id: REMOTE, status: 'online' as const, last_seen: STALE },
			{ host_id: OTHER, status: 'online' as const, last_seen: FRESH },
		]
		expect(pick({ hosts, localHostId: null })).toBe(OTHER)
	})

	test('no host is preselected when every online row is stale', () => {
		const hosts = [{ host_id: REMOTE, status: 'online' as const, last_seen: STALE }]
		expect(pick({ hosts, localHostId: null })).toBe('')
	})

	test('nothing is picked when nothing is known', () => {
		expect(pick({ hosts: [], localHostId: null, localDaemonStarting: true })).toBe('')
		expect(pick({ hosts: [{ host_id: REMOTE, status: 'offline', last_seen: STALE }], localHostId: null })).toBe('')
	})

	describe('with the local daemon turned off', () => {
		test('an offline local host does not win by default while another host is online', () => {
			expect(pick({ localDaemonEnabled: false })).toBe(OTHER)
			expect(pick({ localDaemonEnabled: false, lastUsedHostId: LOCAL })).toBe(OTHER)
		})

		test('an explicit selection of the offline local host is kept', () => {
			expect(pick({ localDaemonEnabled: false, userSelectedHostId: LOCAL })).toBe(LOCAL)
		})

		test('the offline local host stays the default when no host is online', () => {
			const hosts = [
				{ host_id: REMOTE, status: 'offline' as const, last_seen: STALE },
				{ host_id: LOCAL, status: 'offline' as const, last_seen: STALE },
			]
			expect(pick({ hosts, localDaemonEnabled: false })).toBe(LOCAL)
		})

		test('a local host kept online by a separately started daemon can still win', () => {
			const hosts = [
				{ host_id: OTHER, status: 'online' as const, last_seen: FRESH },
				{ host_id: LOCAL, status: 'online' as const, last_seen: FRESH },
			]
			expect(pick({ hosts, localDaemonEnabled: false })).toBe(LOCAL)
		})
	})
})
