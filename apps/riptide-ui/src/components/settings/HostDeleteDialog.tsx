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
import { AlertTriangle, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

const SHADOW_SCOPES = [HOTKEY_SCOPES.SETTINGS, HOTKEY_SCOPES.ROOT] as const

type HostDeleteDialogProps = {
	open: boolean
	displayName: string
	isPending: boolean
	onOpenChange: (open: boolean) => void
	/** Handles mutation errors at the settings surface. */
	onConfirm: () => Promise<void>
}

export function HostDeleteDialog({ open, displayName, isPending, onOpenChange, onConfirm }: HostDeleteDialogProps) {
	const confirming = useRef(false)
	const [isConfirming, setIsConfirming] = useState(false)
	const pending = isPending || isConfirming
	const changeOpen = useCallback(
		(next: boolean) => {
			if (!isPending && !confirming.current) onOpenChange(next)
		},
		[isPending, onOpenChange],
	)
	const confirm = useCallback(async () => {
		if (!open || isPending || confirming.current) return
		// Synchronous guard also covers repeated events before React renders pending state.
		confirming.current = true
		setIsConfirming(true)
		try {
			await onConfirm()
		} finally {
			confirming.current = false
			setIsConfirming(false)
		}
	}, [open, isPending, onConfirm])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (!pending) void confirm()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.HOST_DELETE_DIALOG] },
		[open, pending, confirm],
	)
	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			changeOpen(false)
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.HOST_DELETE_DIALOG] },
		[open, changeOpen],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.HOST_DELETE_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			shadowScopes={SHADOW_SCOPES}
			componentName="HostDeleteDialog"
		>
			<Dialog open={open} onOpenChange={changeOpen}>
				<DialogContent
					showCloseButton={!pending}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive">
							<AlertTriangle className="size-4" />
							Delete host?
						</DialogTitle>
						<DialogDescription>
							<span className="font-medium text-foreground">{displayName}</span> and its custom name are
							removed. Existing sessions are kept. It comes back if its daemon starts again, but its
							custom name cannot be restored.
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
							<Trash2 className="size-3.5" />
							{pending ? 'Deleting…' : 'Delete host'}
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
