import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
import { Button } from '@humanlayer/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@humanlayer/ui/components/dialog'
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

interface RenameSessionDialogProps {
	sessionId: string | null
	currentName: string
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	onSave: (sessionId: string, name: string) => void
}

export function RenameSessionDialog({
	sessionId,
	currentName,
	isOpen,
	onOpenChange,
	onSave,
}: RenameSessionDialogProps) {
	return (
		<RenameSessionDialogContent
			key={`${sessionId ?? 'none'}:${currentName}:${isOpen ? 'open' : 'closed'}`}
			sessionId={sessionId}
			currentName={currentName}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			onSave={onSave}
		/>
	)
}

function RenameSessionDialogContent({
	sessionId,
	currentName,
	isOpen,
	onOpenChange,
	onSave,
}: RenameSessionDialogProps) {
	const [name, setName] = useState(currentName)

	const trimmedName = name.trim()
	const canSave = Boolean(sessionId && trimmedName && trimmedName !== currentName.trim())

	const handleSave = () => {
		if (!sessionId || !trimmedName) return
		onSave(sessionId, trimmedName)
		onOpenChange(false)
	}

	const handleCancel = () => {
		onOpenChange(false)
	}

	useHotkeys(
		'mod+enter',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (canSave) handleSave()
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.RENAME_SESSION_DIALOG],
		},
		[isOpen, canSave, handleSave],
	)

	useHotkeys(
		'escape',
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			handleCancel()
		},
		{
			enabled: isOpen,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.RENAME_SESSION_DIALOG],
		},
		[isOpen, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.RENAME_SESSION_DIALOG}
			isActive={isOpen}
			rootScopeDisabled={true}
			componentName="RenameSessionDialog"
		>
			<Dialog open={isOpen} onOpenChange={onOpenChange}>
				<DialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>Rename session</DialogTitle>
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="rename-session-name">Session name</Label>
						<Input
							id="rename-session-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') handleSave()
							}}
							autoFocus
						/>
					</div>
					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button type="button" variant="secondary" onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button type="button" onClick={handleSave} disabled={!canSave}>
							Save
							<KeyboardShortcut size="xs" className="ml-1">
								{typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
									? '⌘+ENTER'
									: 'Ctrl+ENTER'}
							</KeyboardShortcut>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
