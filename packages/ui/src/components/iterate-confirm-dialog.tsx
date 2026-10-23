import { Button } from '@humanlayer/ui/components/button'
import { Checkbox } from '@humanlayer/ui/components/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { IterationCcw } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useHotkeys } from '@humanlayer/react-hotkeys-hook'

export interface IterateConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	silenced: boolean
	onSilencedChange: (silenced: boolean) => void
	hotkeyScope?: string
}

export function IterateConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	silenced: _silenced,
	onSilencedChange,
	hotkeyScope,
}: IterateConfirmDialogProps) {
	const [localDontShow, setLocalDontShow] = useState(false)

	const handleConfirm = useCallback(() => {
		if (localDontShow) {
			onSilencedChange(true)
		}
		onConfirm()
		onOpenChange(false)
		setLocalDontShow(false)
	}, [localDontShow, onSilencedChange, onConfirm, onOpenChange])

	const handleCancel = useCallback(() => {
		onOpenChange(false)
		setLocalDontShow(false)
	}, [onOpenChange])

	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleConfirm()
		},
		{
			enabled: open && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, handleConfirm, hotkeyScope],
	)

	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		},
		{
			enabled: open && !!hotkeyScope,
			enableOnFormTags: true,
			scopes: hotkeyScope ? [hotkeyScope] : undefined,
		},
		[open, handleCancel, hotkeyScope],
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="overflow-hidden"
				style={{ width: 'min(90%, 35rem)', maxWidth: 'min(90%, 35rem)' }}
				onEscapeKeyDown={(e) => e.preventDefault()}
				onPointerDownOutside={(e) => e.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[var(--terminal-success)] text-base font-bold">
						<IterationCcw className="h-4 w-4" />
						Continue in New Session?
					</DialogTitle>
					<DialogDescription asChild>
						<div className="space-y-2">
							<p>
								This will launch an iteration on the current workflow phase in a new session. Make sure any
								feedback is captured in your message or the current artifacts before proceeding.
							</p>
						</div>
					</DialogDescription>
				</DialogHeader>
				<div className="flex items-center space-x-2 py-2">
					<Checkbox
						id="dont-show-again"
						checked={localDontShow}
						onCheckedChange={(checked) => {
							setLocalDontShow(checked === true)
							if (checked) {
								onSilencedChange(true)
							}
						}}
					/>
					<Label htmlFor="dont-show-again" className="text-sm text-muted-foreground cursor-pointer">
						Don't show me this again
					</Label>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={handleCancel}>
						Cancel
					</Button>
					<Button variant="loud-success-cta" onClick={handleConfirm}>
						Continue in New Session
						<kbd className="ml-1 px-1 py-0.5 text-xs bg-muted/50 rounded">
							{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
								? '⌘'
								: 'Ctrl'}
							+ENTER
						</kbd>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
