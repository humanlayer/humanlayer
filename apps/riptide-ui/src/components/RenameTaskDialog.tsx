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
import { Input } from '@humanlayer/ui/components/input'
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

interface RenameTaskDialogProps {
	taskId: string | null
	currentName: string
	isOpen: boolean
	onOpenChange: (open: boolean) => void
	onSave: (taskId: string, name: string) => void
	/**
	 * When true, renders a destructive warning line under the title indicating the
	 * admin is renaming another user's session. No behavior change otherwise — the
	 * same dialog is reused for the owner sidebar rename (where this is omitted).
	 */
	isAdminOverride?: boolean
}

export function RenameTaskDialog({
	taskId,
	currentName,
	isOpen,
	onOpenChange,
	onSave,
	isAdminOverride,
}: RenameTaskDialogProps) {
	return (
		<RenameTaskDialogContent
			key={`${taskId ?? 'none'}:${currentName}:${isOpen ? 'open' : 'closed'}`}
			taskId={taskId}
			currentName={currentName}
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			onSave={onSave}
			isAdminOverride={isAdminOverride}
		/>
	)
}

function RenameTaskDialogContent({
	taskId,
	currentName,
	isOpen,
	onOpenChange,
	onSave,
	isAdminOverride,
}: RenameTaskDialogProps) {
	const [name, setName] = useState(currentName)

	const trimmedName = name.trim()
	const canSave = Boolean(taskId && trimmedName && trimmedName !== currentName.trim())

	const handleSave = () => {
		if (!taskId || !trimmedName) return
		onSave(taskId, trimmedName)
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
			scopes: [HOTKEY_SCOPES.RENAME_TASK_DIALOG],
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
			scopes: [HOTKEY_SCOPES.RENAME_TASK_DIALOG],
		},
		[isOpen, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.RENAME_TASK_DIALOG}
			isActive={isOpen}
			rootScopeDisabled={true}
			componentName="RenameTaskDialog"
		>
			<Dialog open={isOpen} onOpenChange={onOpenChange}>
				<DialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>Rename task</DialogTitle>
						{isAdminOverride && (
							<DialogDescription className="text-destructive">
								As an admin, you can rename another user&apos;s session.
							</DialogDescription>
						)}
					</DialogHeader>
					<div className="space-y-2">
						<Label htmlFor="rename-task-name">Task name</Label>
						<Input
							id="rename-task-name"
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
