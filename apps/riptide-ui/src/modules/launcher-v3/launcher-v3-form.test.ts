import { describe, expect, test } from 'vitest'

import type { HostLaunchTarget } from '@/lib/host-state'

import { createLauncherV3DefaultValues, getLaunchReadiness, refreshHostLaunchBlocker } from './launcher-v3-form'

const readyValues = createLauncherV3DefaultValues({
	hostId: 'host-1',
	directory: '/workspace',
	prompt: 'Fix the flaky test',
	title: 'Fix flaky test',
	slug: 'fix-flaky-test',
	model: 'opus',
})

function host(overrides: Partial<HostLaunchTarget>): HostLaunchTarget {
	return { state: 'online', registered: true, hostLabel: 'Build box', isLocal: false, ...overrides }
}

describe('getLaunchReadiness host checks', () => {
	test('an empty host blocks the launch', () => {
		expect(getLaunchReadiness({ ...readyValues, hostId: null }).blockedReason?.code).toBe('no-host')
	})

	test.each(['online', 'starting', 'updating', 'offline'] as const)(
		'a registered %s host can take a launch',
		(state) => {
			expect(getLaunchReadiness(readyValues, host({ state }))).toEqual({ canLaunch: true, blockedReason: null })
		},
	)

	test('this device with no host row yet blocks the launch until it is online', () => {
		expect(
			getLaunchReadiness(readyValues, host({ state: 'starting', registered: false, isLocal: true }))
				.blockedReason,
		).toEqual({ code: 'host-unavailable', label: 'Wait for this device to come online' })
	})

	test('an unknown host state does not block the launch', () => {
		expect(getLaunchReadiness(readyValues).canLaunch).toBe(true)
	})
})

describe('refreshHostLaunchBlocker', () => {
	const waitForDevice = { code: 'host-unavailable', label: 'Wait for this device to come online' } as const
	const unregisteredDevice = host({ state: 'starting', registered: false, isLocal: true })

	test('clears a host blocker once the host can take the launch', () => {
		expect(refreshHostLaunchBlocker(waitForDevice, 'host-1', host({ isLocal: true }))).toBeNull()
	})

	test('keeps a host blocker while the host still cannot take the launch', () => {
		expect(refreshHostLaunchBlocker(waitForDevice, 'host-1', unregisteredDevice)).toEqual(waitForDevice)
	})

	test('clears the missing-host blocker once a host is picked', () => {
		const noHost = { code: 'no-host', label: 'Connect a host to launch' } as const
		expect(refreshHostLaunchBlocker(noHost, 'host-1', host({}))).toBeNull()
	})

	test('leaves other blockers and an empty blocker unchanged', () => {
		const noPrompt = { code: 'no-prompt', label: 'Describe the task or attach a ticket' } as const
		expect(refreshHostLaunchBlocker(noPrompt, 'host-1', host({}))).toEqual(noPrompt)
		expect(refreshHostLaunchBlocker(null, 'host-1', unregisteredDevice)).toBeNull()
	})
})
