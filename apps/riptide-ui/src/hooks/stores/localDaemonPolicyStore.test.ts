import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

import {
	applySavedLocalDaemonPolicy,
	retryStoppingLocalDaemon,
	turnOffLocalDaemon,
	turnOnLocalDaemon,
	useLocalDaemonPolicyStore,
	whenLocalDaemonPolicySettled,
} from './localDaemonPolicyStore'

const desktop = vi.hoisted(() => ({ setDaemonManagement: vi.fn<(enabled: boolean) => Promise<void>>() }))

vi.mock('@/integrations/desktop/daemon', () => ({ setDaemonManagement: desktop.setDaemonManagement }))

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

describe('local daemon policy', () => {
	beforeEach(() => {
		desktop.setDaemonManagement.mockReset().mockResolvedValue(undefined)
		useSettingsStore.setState({ localDaemonEnabled: true })
		useLocalDaemonPolicyStore.setState({ stopStatus: 'idle' })
	})

	afterEach(async () => {
		await whenLocalDaemonPolicySettled()
	})

	test('defaults to on and is persisted with local settings', () => {
		expect(useSettingsStore.getInitialState().localDaemonEnabled).toBe(true)
		const persisted = useSettingsStore.persist.getOptions().partialize?.(useSettingsStore.getState())
		expect(persisted).toMatchObject({ localDaemonEnabled: true })
	})

	test('turning off saves the preference, resets launch progress, and reports stopping until done', async () => {
		const stop = deferred()
		desktop.setDaemonManagement.mockReturnValueOnce(stop.promise)
		useLocalDaemonLaunchStore.getState().launchStarted()

		const done = turnOffLocalDaemon()

		expect(useSettingsStore.getState().localDaemonEnabled).toBe(false)
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('idle')
		expect(useLocalDaemonPolicyStore.getState().stopStatus).toBe('stopping')
		stop.resolve()
		await done
		expect(desktop.setDaemonManagement).toHaveBeenCalledWith(false)
		expect(useLocalDaemonPolicyStore.getState().stopStatus).toBe('idle')
	})

	test('a failed stop keeps the preference off and can be retried', async () => {
		desktop.setDaemonManagement.mockRejectedValueOnce(new Error('Failed to stop every local daemon'))

		await turnOffLocalDaemon()
		expect(useSettingsStore.getState().localDaemonEnabled).toBe(false)
		expect(useLocalDaemonPolicyStore.getState().stopStatus).toBe('failed')

		await retryStoppingLocalDaemon()
		expect(desktop.setDaemonManagement).toHaveBeenCalledTimes(2)
		expect(useLocalDaemonPolicyStore.getState().stopStatus).toBe('idle')
	})

	test('changes reach the desktop app in request order', async () => {
		const stop = deferred()
		desktop.setDaemonManagement.mockReturnValueOnce(stop.promise)

		void turnOffLocalDaemon()
		const enabled = turnOnLocalDaemon()
		await Promise.resolve()
		expect(desktop.setDaemonManagement.mock.calls).toEqual([[false]])

		stop.resolve()
		await enabled
		expect(desktop.setDaemonManagement.mock.calls).toEqual([[false], [true]])
		expect(useSettingsStore.getState().localDaemonEnabled).toBe(true)
		expect(useLocalDaemonPolicyStore.getState().stopStatus).toBe('idle')
	})

	test('reapplies the saved preference', async () => {
		useSettingsStore.setState({ localDaemonEnabled: false })
		await applySavedLocalDaemonPolicy()
		expect(desktop.setDaemonManagement).toHaveBeenCalledWith(false)
	})
})
