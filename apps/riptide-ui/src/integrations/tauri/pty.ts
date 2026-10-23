import { Channel, invoke } from '@tauri-apps/api/core'

import { logger } from '@/lib/logger'
import { isTauri } from '@/lib/utils'

/**
 * Event types sent from the PTY via Tauri Channel
 */
export type PtyEvent = { event: 'output'; data: { data: number[] } } | { event: 'exit'; data: { code: number | null } }

export function createPtyEventChannel(onEvent: (event: PtyEvent) => void): Channel<PtyEvent> {
	const channel = new Channel<PtyEvent>()
	channel.onmessage = onEvent
	return channel
}

/**
 * Create a new PTY session in the given working directory.
 * Output is streamed via the provided Channel callback.
 * Returns the PTY ID, or null if not in Tauri environment.
 */
export async function createPty(cwd: string, onEvent: Channel<PtyEvent>): Promise<string | null> {
	if (!isTauri()) {
		return null
	}

	try {
		return await invoke<string>('pty_create', { cwd, onEvent })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to create PTY', { error: message, cwd })
		throw new Error(message)
	}
}

/**
 * Attach a new Channel to an existing PTY session.
 * Replays any buffered output produced while the PTY was detached.
 */
export async function attachPty(ptyId: string, onEvent: Channel<PtyEvent>): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('pty_attach', { ptyId, onEvent })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to attach to PTY', { error: message, ptyId })
		throw new Error(message)
	}
}

/**
 * Detach the Channel from a PTY session without killing it.
 * Output produced after detach is buffered and replayed on next attach.
 */
export async function detachPty(ptyId: string): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('pty_detach', { ptyId })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to detach PTY', { error: message, ptyId })
		// Don't throw - detach is best-effort cleanup
	}
}

/**
 * Write input data to a PTY session.
 */
export async function writePty(ptyId: string, data: Uint8Array): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('pty_write', { ptyId, data: Array.from(data) })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to write to PTY', { error: message, ptyId })
		throw new Error(message)
	}
}

/**
 * Resize a PTY session to the given dimensions.
 */
export async function resizePty(ptyId: string, cols: number, rows: number): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('pty_resize', { ptyId, cols, rows })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to resize PTY', { error: message, ptyId, cols, rows })
		throw new Error(message)
	}
}

/**
 * Kill a PTY session and clean up resources.
 */
export async function killPty(ptyId: string): Promise<void> {
	if (!isTauri()) {
		return
	}

	try {
		await invoke<void>('pty_kill', { ptyId })
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to kill PTY', { error: message, ptyId })
		// Don't throw - kill is best-effort cleanup
	}
}

/**
 * List all active PTY session IDs.
 */
export async function listPtys(): Promise<string[]> {
	if (!isTauri()) {
		return []
	}

	try {
		return await invoke<string[]>('pty_list')
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		logger.error('Failed to list PTYs', { error: message })
		return []
	}
}
