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
import { AlertTriangle } from 'lucide-react'
import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'
import { formatRunningSessions } from '@/lib/host-stats'

type HostUpdateConfirmDialogProps = {
	open: boolean
	targetDaemonVersion: string
	activeSessionCount: number
	oldSelfUpdater: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}

export function HostUpdateConfirmDialog({
	open,
	targetDaemonVersion,
	activeSessionCount,
	oldSelfUpdater,
	onOpenChange,
	onConfirm,
}: HostUpdateConfirmDialogProps) {
	const close = useCallback(() => onOpenChange(false), [onOpenChange])
	const confirm = useCallback(() => {
		onOpenChange(false)
		onConfirm()
	}, [onConfirm, onOpenChange])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			confirm()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.HOST_UPDATE_CONFIRM_DIALOG] },
		[open, confirm],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			close()
		},
		{ enabled: open, enableOnFormTags: true, scopes: [HOTKEY_SCOPES.HOST_UPDATE_CONFIRM_DIALOG] },
		[open, close],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.HOST_UPDATE_CONFIRM_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			componentName="HostUpdateConfirmDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive">
							<AlertTriangle className="size-4" />
							Update daemon?
						</DialogTitle>
						<DialogDescription>
							The daemon restarts to install {targetDaemonVersion}.
							{activeSessionCount > 0 &&
								` This stops ${formatRunningSessions(activeSessionCount)} on this host.`}
						</DialogDescription>
						{oldSelfUpdater && (
							<DialogDescription>
								If the host still shows offline, restart the daemon manually.
							</DialogDescription>
						)}
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={close}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="destructive" onClick={confirm}>
							Update
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
