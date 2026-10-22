import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { useCallback, useRef, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

const SHADOW_SCOPES = [HOTKEY_SCOPES.SETTINGS, HOTKEY_SCOPES.ROOT] as const

type LocalDaemonStopDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Resolves once the stop attempt finishes; the settings row reports a failure. */
	onConfirm: () => Promise<void>
}

export function LocalDaemonStopDialog({ open, onOpenChange, onConfirm }: LocalDaemonStopDialogProps) {
	const confirming = useRef(false)
	const [pending, setPending] = useState(false)
	const changeOpen = useCallback(
		(next: boolean) => {
			if (!confirming.current) onOpenChange(next)
		},
		[onOpenChange],
	)
	const confirm = useCallback(async () => {
		if (!open || confirming.current) return
		// Synchronous guard also covers repeated events before React renders pending state.
		confirming.current = true
		setPending(true)
		try {
			await onConfirm()
		} finally {
			confirming.current = false
			setPending(false)
		}
	}, [open, onConfirm])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (!pending) void confirm()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.LOCAL_DAEMON_STOP_DIALOG] },
		[open, pending, confirm],
	)
	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			changeOpen(false)
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.LOCAL_DAEMON_STOP_DIALOG] },
		[open, changeOpen],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.LOCAL_DAEMON_STOP_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			shadowScopes={SHADOW_SCOPES}
			componentName="LocalDaemonStopDialog"
		>
			<Dialog open={open} onOpenChange={changeOpen}>
				<DialogContent
					showCloseButton={!pending}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle>Stop the local daemon?</DialogTitle>
						<DialogDescription>
							This interrupts sessions on this device. Your tasks and session history stay saved. You need
							an online host to run sessions.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={() => changeOpen(false)} disabled={pending}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="destructive" onClick={() => void confirm()} disabled={pending}>
							{pending ? 'Stopping…' : 'Stop daemon'}
							<KeyboardShortcut size="xs" className="ml-1">
								{navigator.platform.toLowerCase().includes('mac') ? '⌘+Enter' : 'Ctrl+Enter'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
