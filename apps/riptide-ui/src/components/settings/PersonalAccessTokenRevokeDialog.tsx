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
import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

type PersonalAccessTokenRevokeDialogProps = {
	open: boolean
	tokenName: string
	isPending: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}

export function PersonalAccessTokenRevokeDialog({
	open,
	tokenName,
	isPending,
	onOpenChange,
	onConfirm,
}: PersonalAccessTokenRevokeDialogProps) {
	const close = useCallback(() => onOpenChange(false), [onOpenChange])
	const confirm = useCallback(() => {
		if (isPending) return
		onConfirm()
	}, [isPending, onConfirm])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			confirm()
		},
		{
			enabled: open && !isPending,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.PERSONAL_ACCESS_TOKEN_REVOKE_DIALOG],
		},
		[open, isPending, confirm],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			close()
		},
		{
			enabled: open && !isPending,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.PERSONAL_ACCESS_TOKEN_REVOKE_DIALOG],
		},
		[open, isPending, close],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.PERSONAL_ACCESS_TOKEN_REVOKE_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			componentName="PersonalAccessTokenRevokeDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive">
							<AlertTriangle className="size-4" />
							Permanently revoke token?
						</DialogTitle>
						<DialogDescription>
							The token <span className="font-medium text-foreground">{tokenName}</span> will stop working
							immediately. This action cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={close} disabled={isPending}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="destructive" onClick={confirm} disabled={isPending}>
							<Trash2 className="size-3.5" />
							{isPending ? 'Revoking...' : 'Revoke token'}
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
