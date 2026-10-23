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
import { Archive } from 'lucide-react'
import { useCallback } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export function ProjectArchiveConfirmDialog({
	projectName,
	pending,
	onConfirm,
	onCancel,
}: {
	readonly projectName: string
	readonly pending: boolean
	readonly onConfirm: () => void
	readonly onCancel: () => void
}) {
	const handleConfirm = useCallback(() => {
		if (!pending) onConfirm()
	}, [pending, onConfirm])

	const handleCancel = useCallback(() => {
		if (!pending) onCancel()
	}, [pending, onCancel])

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleConfirm()
		},
		{
			enabled: !pending,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.PROJECT_ARCHIVE_DIALOG],
		},
		[pending, handleConfirm],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{
			enabled: !pending,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.PROJECT_ARCHIVE_DIALOG],
		},
		[pending, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.PROJECT_ARCHIVE_DIALOG}
			isActive={true}
			rootScopeDisabled={true}
			componentName="ProjectArchiveConfirmDialog"
		>
			<Dialog open onOpenChange={(open) => !open && handleCancel()}>
				<DialogContent
					className="overflow-hidden"
					style={{ width: 'min(90%, 32rem)', maxWidth: 'min(90%, 32rem)' }}
					onEscapeKeyDown={(event) => event.preventDefault()}
					onPointerDownOutside={(event) => event.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive text-base font-bold">
							<Archive className="h-4 w-4" />
							Archive project?
						</DialogTitle>
						<DialogDescription>
							This removes <strong className="text-foreground">{projectName}</strong> from available
							projects. Existing workspaces are not deleted.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button variant="secondary" disabled={pending} onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="destructive" disabled={pending} onClick={handleConfirm}>
							<Archive className="size-3.5" />
							{pending ? 'Archiving…' : 'Archive'}
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
									? '⌘+Enter'
									: 'Ctrl+Enter'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
