import { describe, expect, test } from 'vitest'

import {
	deriveHostState,
	describeHostLaunchBlocker,
	describeHostState,
	hostAcceptsLaunch,
	sortHostsByState,
	type HostStateInput,
	type HostStateRow,
} from './host-state'

const NOW = 1_000_000

function row(overrides: Partial<HostStateRow> = {}): HostStateRow {
	return { status: 'online', last_seen: BigInt(NOW), update_state: null, ...overrides }
}

function derive(overrides: Partial<HostStateInput>) {
	return deriveHostState({ host: row(), isLocal: false, localPhase: 'idle', nowMs: NOW, ...overrides })
}

describe('deriveHostState', () => {
	test('a fresh online row is online', () => {
		expect(derive({})).toBe('online')
	})

	test('an offline or stale row is offline', () => {
		expect(derive({ host: row({ status: 'offline' }) })).toBe('offline')
		expect(derive({ host: row({ last_seen: BigInt(NOW - 30_000) }) })).toBe('offline')
	})

	test('a host installing an update is updating, online or not', () => {
		expect(derive({ host: row({ update_state: 'installing' }) })).toBe('updating')
		expect(derive({ host: row({ status: 'offline', update_state: 'installing' }) })).toBe('updating')
	})

	test('a host silent for 5 minutes since it started installing is offline, not updating', () => {
		expect(
			derive({ host: row({ status: 'offline', update_state: 'installing', last_seen: BigInt(NOW - 300_000) }) }),
		).toBe('offline')
	})

	test('a requested or failed update does not change the state', () => {
		expect(derive({ host: row({ update_state: 'requested' }) })).toBe('online')
		expect(derive({ host: row({ status: 'offline', update_state: 'failed' }) })).toBe('offline')
	})

	test('this device is starting while the app starts its daemon and the row is not online', () => {
		for (const localPhase of ['starting', 'syncing-host'] as const) {
			expect(derive({ isLocal: true, localPhase, host: row({ status: 'offline' }) })).toBe('starting')
			expect(derive({ isLocal: true, localPhase, host: row({ last_seen: 0n }) })).toBe('starting')
			expect(derive({ isLocal: true, localPhase, host: null })).toBe('starting')
		}
	})

	test('this device is online as soon as its row is, even while the launch settles', () => {
		expect(derive({ isLocal: true, localPhase: 'syncing-host' })).toBe('online')
	})

	test('a remote host never takes the local launch phase', () => {
		expect(derive({ localPhase: 'starting', host: row({ status: 'offline' }) })).toBe('offline')
	})

	test('a remote host with no row is removed, whatever the local launch phase', () => {
		for (const localPhase of ['idle', 'starting', 'syncing-host', 'ready', 'failed'] as const) {
			expect(derive({ localPhase, host: null })).toBe('removed')
		}
	})

	test('this device is offline when its daemon is not starting', () => {
		for (const localPhase of ['idle', 'ready', 'failed'] as const) {
			expect(derive({ isLocal: true, localPhase, host: row({ status: 'offline' }) })).toBe('offline')
			expect(derive({ isLocal: true, localPhase, host: null })).toBe('offline')
		}
	})
})

describe('hostAcceptsLaunch', () => {
	test('queues on every registered host by default', () => {
		for (const state of ['online', 'starting', 'updating', 'offline'] as const) {
			expect(hostAcceptsLaunch({ state, registered: true })).toBe(true)
		}
	})

	test('the block policy allows only online hosts', () => {
		expect(hostAcceptsLaunch({ state: 'online', registered: true }, 'block')).toBe(true)
		for (const state of ['starting', 'updating', 'offline'] as const) {
			expect(hostAcceptsLaunch({ state, registered: true }, 'block')).toBe(false)
		}
	})

	test('a host with no row cannot take a launch', () => {
		expect(hostAcceptsLaunch({ state: 'starting', registered: false })).toBe(false)
		expect(hostAcceptsLaunch({ state: 'removed', registered: false })).toBe(false)
	})
})

describe('describeHostLaunchBlocker', () => {
	const remote = { hostLabel: 'Build box', isLocal: false, registered: true }

	test('nothing blocks a launch the host can take', () => {
		expect(describeHostLaunchBlocker({ ...remote, state: 'offline' })).toBeNull()
		expect(describeHostLaunchBlocker({ ...remote, state: 'online' }, 'block')).toBeNull()
	})

	test('names the host to wait for', () => {
		expect(describeHostLaunchBlocker({ ...remote, state: 'offline' }, 'block')).toBe(
			'Wait for Build box to come online',
		)
		expect(
			describeHostLaunchBlocker({
				hostLabel: 'This device',
				isLocal: true,
				registered: false,
				state: 'starting',
			}),
		).toBe('Wait for this device to come online')
	})

	test('a removed host asks for another host under either policy', () => {
		for (const policy of ['queue', 'block'] as const) {
			expect(
				describeHostLaunchBlocker(
					{ hostLabel: 'a1b2c3', isLocal: false, registered: false, state: 'removed' },
					policy,
				),
			).toBe('Choose another host')
		}
	})
})

describe('describeHostState', () => {
	const remote = { hostLabel: 'Build box', isLocal: false, acceptsLaunch: true }
	const local = { hostLabel: 'Desk Mac', isLocal: true, acceptsLaunch: true }

	test('an online host has no badge or notice', () => {
		expect(describeHostState({ ...remote, state: 'online' })).toEqual({ badge: null, notice: null })
	})

	test.each([
		['starting', 'Starting…', "Build box is starting. Your task runs when it's online."],
		['updating', 'Updating…', "Build box is updating. Your task runs when it's back."],
		['offline', 'Offline', 'Build box is offline. Your task runs when it reconnects.'],
	] as const)('a queued launch on a %s host', (state, badge, notice) => {
		expect(describeHostState({ ...remote, state })).toEqual({ badge, notice })
	})

	test('this device is named as this device', () => {
		expect(describeHostState({ ...local, state: 'starting' }).notice).toBe(
			"This device is starting. Your task runs when it's online.",
		)
		expect(describeHostState({ ...local, state: 'offline' }).notice).toBe(
			'This device is offline. Your task runs when it reconnects.',
		)
	})

	test('a removed host has no badge and asks for another host', () => {
		expect(
			describeHostState({ hostLabel: 'a1b2c3', isLocal: false, acceptsLaunch: false, state: 'removed' }),
		).toEqual({
			badge: null,
			notice: 'This host is no longer connected. Choose another host.',
		})
	})

	test('a blocked launch says when it can run', () => {
		expect(describeHostState({ ...local, state: 'starting', acceptsLaunch: false })).toEqual({
			badge: 'Starting…',
			notice: "This device is starting. You can launch when it's online.",
		})
		expect(describeHostState({ ...remote, state: 'offline', acceptsLaunch: false })).toEqual({
			badge: 'Offline',
			notice: 'Build box is offline. Choose another host, or launch when it reconnects.',
		})
	})
})

describe('sortHostsByState', () => {
	test('orders online, then starting or updating, then offline, then removed, by name within each group', () => {
		const hosts = [
			{ label: 'delta', state: 'offline' },
			{ label: 'Bravo', state: 'updating' },
			{ label: 'echo', state: 'online' },
			{ label: 'alpha', state: 'starting' },
			{ label: 'Charlie', state: 'online' },
			{ label: 'able', state: 'offline' },
			{ label: 'aardvark', state: 'removed' },
		] as const
		expect(sortHostsByState(hosts).map((host) => host.label)).toEqual([
			'Charlie',
			'echo',
			'alpha',
			'Bravo',
			'able',
			'delta',
			'aardvark',
		])
	})

	test('treats a host with no state as online and leaves the input untouched', () => {
		const hosts = [{ label: 'b', state: 'offline' as const }, { label: 'a' }]
		expect(sortHostsByState(hosts).map((host) => host.label)).toEqual(['a', 'b'])
		expect(hosts.map((host) => host.label)).toEqual(['b', 'a'])
	})
})
