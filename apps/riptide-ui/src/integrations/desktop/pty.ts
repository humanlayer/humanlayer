import type { PtyEvent } from '@humanlayer/riptide-electron-rpc'

import { useTerminalRuntimeStore } from '@/hooks/stores/terminalRuntimeStore'
import * as electronPty from '@/integrations/electron/pty'
import { logger } from '@/lib/logger'
import { isElectron, isTauri } from '@/lib/utils'

export type { PtyEvent }

export type PtyEventListener = (event: PtyEvent) => void

const loadTauriPty = () => import('@/integrations/tauri/pty')

export function isPtyAvailable(): boolean {
	return isElectron() || isTauri()
}

export async function createPty(cwd: string, onEvent: PtyEventListener): Promise<string | null> {
	if (isElectron()) {
		const ptyId = await electronPty.createPty(cwd)
		await electronPty.attachPty(ptyId, onEvent)
		return ptyId
	}
	if (isTauri()) {
		const tauriPty = await loadTauriPty()
		return tauriPty.createPty(cwd, tauriPty.createPtyEventChannel(onEvent))
	}
	return null
}

export async function attachPty(ptyId: string, onEvent: PtyEventListener): Promise<void> {
	if (isElectron()) return electronPty.attachPty(ptyId, onEvent)
	if (isTauri()) {
		const tauriPty = await loadTauriPty()
		return tauriPty.attachPty(ptyId, tauriPty.createPtyEventChannel(onEvent))
	}
}

export async function detachPty(ptyId: string): Promise<void> {
	if (isElectron()) return electronPty.detachPty(ptyId)
	if (isTauri()) return (await loadTauriPty()).detachPty(ptyId)
}

export async function writePty(ptyId: string, data: Uint8Array): Promise<void> {
	if (isElectron()) return electronPty.writePty(ptyId, data)
	if (isTauri()) return (await loadTauriPty()).writePty(ptyId, data)
}

export async function resizePty(ptyId: string, cols: number, rows: number): Promise<void> {
	if (isElectron()) return electronPty.resizePty(ptyId, cols, rows)
	if (isTauri()) return (await loadTauriPty()).resizePty(ptyId, cols, rows)
}

export async function killPty(ptyId: string): Promise<void> {
	if (isElectron()) return electronPty.killPty(ptyId)
	if (isTauri()) return (await loadTauriPty()).killPty(ptyId)
}

export async function listPtys(): Promise<ReadonlyArray<string>> {
	if (isElectron()) return electronPty.listPtys()
	if (isTauri()) return (await loadTauriPty()).listPtys()
	return []
}

export function cleanupPtyForSession(storageKey: string): void {
	const runtimeStore = useTerminalRuntimeStore.getState()
	const pty = runtimeStore.getPty(storageKey)
	if (pty?.state === 'active') {
		void killPty(pty.ptyId).catch((error) => {
			// Electron main captures native kill failures; avoid duplicate renderer events.
			logger.error('Failed to clean up PTY for session', { ptyId: pty.ptyId, error })
		})
	}
	runtimeStore.clearPty(storageKey)
}
