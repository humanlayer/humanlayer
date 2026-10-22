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
import { formatShortcut, hotkeysCatalog } from '@/hotkeysCatalog'

export function GuestCommentIdentityDialog({
	open,
	onSubmit,
	onBack,
}: {
	open: boolean
	onSubmit: (identity: { guestName: string; guestEmail?: string }) => void
	onBack: () => void
}) {
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const canSubmit = Boolean(name.trim())
	const submitShortcut = hotkeysCatalog.textEditing.shortcuts.submit
	const cancelShortcut = hotkeysCatalog.global.shortcuts.unfocusOrBack
	const handleSubmit = () => onSubmit({ guestName: name, guestEmail: email || undefined })

	useHotkeys(
		submitShortcut.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			if (canSubmit) handleSubmit()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.GUEST_COMMENT_IDENTITY_DIALOG],
		},
		[open, canSubmit, name, email, onSubmit],
	)

	useHotkeys(
		cancelShortcut.reactHotkeys,
		(event) => {
			event.preventDefault()
			event.stopPropagation()
			onBack()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			scopes: [HOTKEY_SCOPES.GUEST_COMMENT_IDENTITY_DIALOG],
		},
		[open, onBack],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.GUEST_COMMENT_IDENTITY_DIALOG}
			isActive={open}
			rootScopeDisabled
			componentName="GuestCommentIdentityDialog"
		>
			<Dialog open={open}>
				<DialogContent showCloseButton={false} onEscapeKeyDown={(event) => event.preventDefault()}>
					<DialogHeader>
						<DialogTitle>Add your name</DialogTitle>
						<DialogDescription>Your name appears with comments on this artifact.</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label htmlFor="guest-comment-name">Name</Label>
							<Input
								id="guest-comment-name"
								value={name}
								onChange={(event) => setName(event.target.value)}
								maxLength={100}
								autoFocus
							/>
						</div>
						<div className="grid gap-2">
							<Label htmlFor="guest-comment-email">Email (optional)</Label>
							<Input
								id="guest-comment-email"
								type="email"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								maxLength={320}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button type="button" variant="secondary" onClick={onBack}>
							Back
							<span aria-hidden="true">
								<KeyboardShortcut size="xs" className="ml-1">
									Esc
								</KeyboardShortcut>
							</span>
						</Button>
						<Button type="button" disabled={!canSubmit} onClick={handleSubmit}>
							Continue
							<span aria-hidden="true">
								<KeyboardShortcut size="xs" className="ml-1">
									{formatShortcut(submitShortcut.display)}
								</KeyboardShortcut>
							</span>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</HotkeyScopeBoundary>
	)
}
