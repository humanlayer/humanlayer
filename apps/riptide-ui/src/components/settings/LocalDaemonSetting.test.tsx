import { HotkeysProvider } from '@humanlayer/react-hotkeys-hook'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { scopeManager } from '@/hooks/hotkeys/scopeManager'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { useLocalDaemonPolicyStore, whenLocalDaemonPolicySettled } from '@/hooks/stores/localDaemonPolicyStore'
import { useSettingsStore } from '@/hooks/stores/settingsStore'

import { LocalDaemonSetting } from './LocalDaemonSetting'

const desktop = vi.hoisted(() => ({ setDaemonManagement: vi.fn<(enabled: boolean) => Promise<void>>() }))

vi.mock('@/integrations/desktop/daemon', () => ({ setDaemonManagement: desktop.setDaemonManagement }))

function renderSetting() {
	return render(
		<HotkeysProvider initiallyActiveScopes={[HOTKEY_SCOPES.ROOT]}>
			<HotkeyScopeBoundary scope={HOTKEY_SCOPES.SETTINGS}>
				<LocalDaemonSetting />
			</HotkeyScopeBoundary>
		</HotkeysProvider>,
	)
}

function toggle() {
	return screen.getByRole('switch', { name: 'Local daemon' })
}

beforeEach(() => {
	desktop.setDaemonManagement.mockReset().mockResolvedValue(undefined)
	useSettingsStore.setState({ localDaemonEnabled: true })
	useLocalDaemonPolicyStore.setState({ stopStatus: 'idle' })
})

afterEach(async () => {
	cleanup()
	await whenLocalDaemonPolicySettled()
	await waitFor(() => expect(scopeManager.getStack()).toHaveLength(0))
})

describe('LocalDaemonSetting', () => {
	test('describes what turning it off does', () => {
		renderSetting()
		const description = toggle().getAttribute('aria-describedby') ?? ''
		const text = description
			.split(' ')
			.map((id) => document.getElementById(id)?.textContent)
			.join(' ')
		expect(text).toContain('Turn off to use remote hosts only.')
		expect(text).toContain('Turning this off interrupts sessions on this device.')
	})

	test('cancel leaves the setting and the daemon alone', () => {
		renderSetting()
		fireEvent.click(toggle())
		expect(screen.getByRole('dialog', { name: 'Stop the local daemon?' })).toBeTruthy()

		fireEvent.click(screen.getByRole('button', { name: /Cancel/ }))

		expect(useSettingsStore.getState().localDaemonEnabled).toBe(true)
		expect(desktop.setDaemonManagement).not.toHaveBeenCalled()
		expect(toggle().getAttribute('aria-checked')).toBe('true')
	})

	test('confirming stops the daemon and turns the setting off', async () => {
		renderSetting()
		fireEvent.click(toggle())
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /Stop daemon/ }))
		})

		expect(desktop.setDaemonManagement).toHaveBeenCalledWith(false)
		expect(useSettingsStore.getState().localDaemonEnabled).toBe(false)
		expect(toggle().getAttribute('aria-checked')).toBe('false')
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
	})

	test('a failed stop keeps the setting off and offers a retry', async () => {
		desktop.setDaemonManagement.mockRejectedValueOnce(new Error('Failed to stop every local daemon'))
		renderSetting()
		fireEvent.click(toggle())
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: /Stop daemon/ }))
		})

		const alert = await screen.findByRole('alert')
		expect(alert.textContent).toContain('Could not stop the local daemon')
		expect(toggle().getAttribute('aria-checked')).toBe('false')

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
		})
		expect(desktop.setDaemonManagement).toHaveBeenCalledTimes(2)
		expect(screen.queryByRole('alert')).toBeNull()
	})

	test('turning it back on needs no confirmation', async () => {
		useSettingsStore.setState({ localDaemonEnabled: false })
		renderSetting()
		await act(async () => {
			fireEvent.click(toggle())
		})

		expect(screen.queryByRole('dialog')).toBeNull()
		expect(desktop.setDaemonManagement).toHaveBeenCalledWith(true)
		expect(useSettingsStore.getState().localDaemonEnabled).toBe(true)
	})
})
