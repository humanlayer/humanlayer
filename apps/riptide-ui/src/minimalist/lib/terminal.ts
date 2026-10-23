import { useLocalStorage } from '@uidotdev/usehooks'
import { useLayoutEffect, useRef } from 'react'

import { useLocalHostId } from '@/hooks/use-colocated'
import { useMountEffect } from '@/hooks/useMountEffect'
import { isPtyAvailable } from '@/integrations/desktop/pty'
import { useTask } from '@/minimalist/lib/data'
import { matchShortcut } from '@/minimalist/lib/shortcuts'
import { useUi } from '@/minimalist/lib/ui-state'

/**
 * The task's terminal: where its shell starts, whether this computer can run it, and whether it
 * is open. The open flag and the shell are shared with the standard task page, so switching
 * interfaces keeps both.
 */
export function useTaskTerminal(taskId: string) {
	const { task, sessions } = useTask(taskId)
	const localHostId = useLocalHostId()
	const { showToast } = useUi()
	const [stored, setStored] = useLocalStorage<boolean>(`terminal-open-task-${taskId}`, false)
	const latest = sessions.filter((session) => !session.archived).at(-1) ?? sessions.at(-1) ?? null
	const directory = latest?.working_directory || task?.default_working_directory || null
	const blocked = blockedReason(directory, latest?.host_id, localHostId)
	const open = stored && !blocked
	return {
		storageKey: `task-${taskId}`,
		directory,
		blocked,
		open,
		close: () => setStored(false),
		toggle: () => {
			if (blocked) showToast(blocked)
			else setStored(!open)
		},
	}
}

/** Why this computer can't open the task's terminal, or null when it can. */
function blockedReason(
	directory: string | null,
	sessionHostId: string | undefined,
	localHostId: string | null,
): string | null {
	if (!isPtyAvailable()) return 'The terminal opens in the desktop app.'
	if (!directory) return 'This task has no working directory yet. Start a session first.'
	if (sessionHostId && sessionHostId !== localHostId)
		return 'This task runs on another host. The terminal opens only on the host that runs it.'
	return null
}

/** Runs `onToggle` for ⌘J while the task page is mounted, including from inside the terminal. */
export function useTerminalShortcut(onToggle: () => void) {
	const handle = useRef(onToggle)
	useLayoutEffect(() => {
		handle.current = onToggle
	})
	useMountEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.isComposing || matchShortcut(event)?.id !== 'terminal') return
			event.preventDefault()
			handle.current()
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
}
