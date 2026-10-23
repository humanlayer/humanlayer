import type { DaemonLaunchResult } from '@humanlayer/riptide-electron-rpc'
import { ORPCError } from '@orpc/client'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { useAgentConnectionsStore } from '@/hooks/stores/agentConnectionsStore'
import { useLocalDaemonLaunchStore } from '@/hooks/stores/localDaemonLaunchStore'
import { turnOffLocalDaemon, turnOnLocalDaemon } from '@/hooks/stores/localDaemonPolicyStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { DAEMON_LAUNCH_FAILED_TOAST_ID, useDaemonManager } from './use-daemon-manager'

const desktop = vi.hoisted(() => ({
	startDaemon: vi.fn<() => Promise<DaemonLaunchResult | null>>(),
	getHostId: vi.fn<() => Promise<string | null>>(),
	createToken: vi.fn<() => Promise<{ token: string }>>(),
}))

const sonner = vi.hoisted(() => ({
	error: vi.fn<(title: string, options: { id: string; description: string; action: ReactNode }) => void>(),
	dismiss: vi.fn<(id?: string) => void>(),
}))

vi.mock('sonner', () => ({ toast: { error: sonner.error, dismiss: sonner.dismiss } }))

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))
vi.mock('@workos-inc/authkit-react', () => ({
	useAuth: () => ({ user: { id: 'user-1' }, organizationId: 'org-1', isLoading: false }),
}))
vi.mock('@/orpc/client', () => {
	const api = { client: { auth: { daemon: { token: { create: () => desktop.createToken() } } } } }
	return { useRiptideApi: () => api }
})
vi.mock('@/integrations/desktop/host', () => ({ getHostId: desktop.getHostId }))
vi.mock('@/integrations/desktop/daemon', () => ({
	shouldStartManagedDaemon: () => true,
	onDaemonLifecycleEvent: async () => null,
	startDaemon: desktop.startDaemon,
	setDaemonManagement: async () => {},
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

const LAUNCHED: DaemonLaunchResult = { type: 'daemon_ready' }

const TIMED_OUT = new Error('Timed out waiting for daemon launch result')

function clickRetry() {
	const [, options] = sonner.error.mock.lastCall ?? []
	render(<>{options?.action}</>)
	act(() => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))
}

async function flush() {
	await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

describe('useDaemonManager', () => {
	beforeEach(() => {
		desktop.startDaemon.mockReset()
		desktop.getHostId.mockReset().mockResolvedValue('host-this-device')
		desktop.createToken.mockReset().mockResolvedValue({ token: 'daemon-token' })
		sonner.error.mockReset()
		sonner.dismiss.mockReset()
		useLocalDaemonLaunchStore.setState({ phase: 'idle', launchAttempt: 0 })
		useAgentConnectionsStore.setState({ lastVerifiedClaudePath: '/usr/local/bin/claude' })
		useSettingsStore.setState({ localDaemonEnabled: true })
	})

	afterEach(() => {
		useLocalDaemonLaunchStore.getState().launchStarted()
		useLocalDaemonLaunchStore.setState({ phase: 'idle' })
	})

	test('does not request a token or start while the local daemon is turned off', async () => {
		useSettingsStore.setState({ localDaemonEnabled: false })
		renderHook(() => useDaemonManager())
		await flush()

		expect(desktop.createToken).not.toHaveBeenCalled()
		expect(desktop.startDaemon).not.toHaveBeenCalled()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('idle')
	})

	test('starts once the local daemon is turned back on', async () => {
		useSettingsStore.setState({ localDaemonEnabled: false })
		desktop.startDaemon.mockResolvedValue(LAUNCHED)
		renderHook(() => useDaemonManager())
		await flush()

		await act(() => turnOnLocalDaemon())
		await flush()

		expect(desktop.startDaemon).toHaveBeenCalledTimes(1)
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('syncing-host')
	})

	test('ignores a launch that completes after the local daemon is turned off', async () => {
		const launch = deferred<DaemonLaunchResult | null>()
		desktop.startDaemon.mockReturnValue(launch.promise)
		renderHook(() => useDaemonManager())
		await flush()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('starting')

		await act(() => turnOffLocalDaemon())
		launch.resolve(LAUNCHED)
		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('idle')
		expect(sonner.error).not.toHaveBeenCalled()
		expect(desktop.startDaemon).toHaveBeenCalledTimes(1)
	})

	test('records success once the launch returns', async () => {
		desktop.startDaemon.mockResolvedValue(LAUNCHED)
		renderHook(() => useDaemonManager())

		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('syncing-host')
	})

	test('a superseded launch that succeeds late does not end the launch that replaced it', async () => {
		const superseded = deferred<DaemonLaunchResult | null>()
		const replacement = deferred<DaemonLaunchResult | null>()
		desktop.startDaemon.mockReturnValueOnce(superseded.promise).mockReturnValueOnce(replacement.promise)
		const { rerender } = renderHook(() => useDaemonManager())
		await flush()

		act(() => useAgentConnectionsStore.setState({ lastVerifiedClaudePath: '/opt/claude/bin/claude' }))
		rerender()
		await flush()
		expect(desktop.startDaemon).toHaveBeenCalledTimes(2)

		superseded.resolve(LAUNCHED)
		await flush()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('starting')

		replacement.resolve(LAUNCHED)
		await flush()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('syncing-host')
	})

	test('a launch cancelled by unmount records neither success nor failure', async () => {
		const launch = deferred<DaemonLaunchResult | null>()
		desktop.startDaemon.mockReturnValue(launch.promise)
		const { unmount } = renderHook(() => useDaemonManager())
		await flush()

		unmount()
		launch.resolve(LAUNCHED)
		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('starting')
	})

	test('a launch cancelled while the host id loads does not record a failure', async () => {
		const hostId = deferred<string | null>()
		desktop.getHostId.mockReturnValue(hostId.promise)
		const { unmount } = renderHook(() => useDaemonManager())

		unmount()
		hostId.resolve(null)
		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('starting')
		expect(desktop.startDaemon).not.toHaveBeenCalled()
	})

	test('a failed launch shows one toast with a Retry action', async () => {
		desktop.startDaemon.mockRejectedValue(TIMED_OUT)
		renderHook(() => useDaemonManager())

		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('failed')
		expect(sonner.error).toHaveBeenCalledTimes(1)
		expect(sonner.error).toHaveBeenCalledWith(
			'Could not start the daemon on this device',
			expect.objectContaining({
				id: DAEMON_LAUNCH_FAILED_TOAST_ID,
				description: 'Tasks on this device wait until the daemon starts.',
			}),
		)
		render(<>{sonner.error.mock.lastCall?.[1].action}</>)
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
	})

	test('Retry dismisses the toast and runs the same launch again', async () => {
		const retried = deferred<DaemonLaunchResult | null>()
		desktop.startDaemon.mockRejectedValueOnce(TIMED_OUT).mockReturnValueOnce(retried.promise)
		renderHook(() => useDaemonManager())
		await flush()

		clickRetry()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('starting')
		expect(sonner.dismiss).toHaveBeenCalledWith(DAEMON_LAUNCH_FAILED_TOAST_ID)
		await flush()

		expect(desktop.createToken).toHaveBeenCalledTimes(2)
		expect(desktop.startDaemon).toHaveBeenCalledTimes(2)
		expect(desktop.startDaemon).toHaveBeenLastCalledWith(
			'daemon-token',
			'user-1',
			'org-1',
			'auto',
			'/usr/local/bin/claude',
		)

		retried.resolve(LAUNCHED)
		await flush()
		expect(useLocalDaemonLaunchStore.getState().phase).toBe('syncing-host')
	})

	test('a second failure replaces the toast instead of stacking another', async () => {
		desktop.startDaemon.mockRejectedValue(TIMED_OUT)
		renderHook(() => useDaemonManager())
		await flush()

		clickRetry()
		await flush()

		expect(sonner.error).toHaveBeenCalledTimes(2)
		expect(sonner.error.mock.calls.map(([, options]) => options.id)).toEqual([
			DAEMON_LAUNCH_FAILED_TOAST_ID,
			DAEMON_LAUNCH_FAILED_TOAST_ID,
		])
	})

	test('Retry while a launch is in flight does not start another', async () => {
		desktop.startDaemon.mockReturnValue(deferred<DaemonLaunchResult | null>().promise)
		renderHook(() => useDaemonManager())
		await flush()

		act(() => useLocalDaemonLaunchStore.getState().retryLaunch())
		await flush()

		expect(desktop.createToken).toHaveBeenCalledTimes(1)
		expect(desktop.startDaemon).toHaveBeenCalledTimes(1)
	})

	test('a launch cancelled by unmount shows no toast', async () => {
		let rejectLaunch!: (error: Error) => void
		desktop.startDaemon.mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectLaunch = reject
			}),
		)
		const { unmount } = renderHook(() => useDaemonManager())
		await flush()

		unmount()
		rejectLaunch(TIMED_OUT)
		await flush()

		expect(sonner.error).not.toHaveBeenCalled()
	})

	test.each([
		['the native side cancelled the launch', new Error('Daemon launch cancelled')],
		['the daemon could not authenticate', new Error('Daemon authentication failed: token expired')],
		['the token request was unauthorized', new ORPCError('UNAUTHORIZED')],
	])('shows no toast when %s', async (_reason, error) => {
		if (error instanceof ORPCError) desktop.createToken.mockRejectedValue(error)
		else desktop.startDaemon.mockRejectedValue(error)
		renderHook(() => useDaemonManager())

		await flush()

		expect(useLocalDaemonLaunchStore.getState().phase).toBe('failed')
		expect(sonner.error).not.toHaveBeenCalled()
	})
})
