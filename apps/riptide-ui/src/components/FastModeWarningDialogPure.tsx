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
import { KeyboardShortcut } from '@humanlayer/ui/components/keyboard-shortcut'
import { Label } from '@humanlayer/ui/components/label'
import { AlertTriangle, Zap } from 'lucide-react'
import { useCallback } from 'react'

export interface FastModeWarningDialogPureProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: (dontAskAgain: boolean) => void
	dontAskAgain: boolean
	onDontAskAgainChange: (checked: boolean) => void
}

export function FastModeWarningDialogPure({
	open,
	onOpenChange,
	onConfirm,
	dontAskAgain,
	onDontAskAgainChange,
}: FastModeWarningDialogPureProps) {
	const handleConfirm = useCallback(() => {
		onConfirm(dontAskAgain)
		onOpenChange(false)
	}, [dontAskAgain, onConfirm, onOpenChange])
	const handleCancel = useCallback(() => onOpenChange(false), [onOpenChange])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="overflow-hidden"
				style={{ width: 'min(90%, 35rem)', maxWidth: 'min(90%, 35rem)' }}
				onPointerDownOutside={(event) => event.preventDefault()}
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[var(--terminal-warning)] text-base font-bold">
						<AlertTriangle className="h-4 w-4" />
						Enable <strong>Fast Mode</strong>?
					</DialogTitle>
					<DialogDescription asChild>
						<div className="space-y-2">
							<p>Fast Mode prioritizes throughput by routing your session to the priority tier.</p>
							<p className="text-[var(--terminal-warning)] font-semibold">
								This may incur 2–4× usage charges compared to standard requests.
							</p>
						</div>
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-xs">
					Toggle at any time with the <Zap className="inline h-3.5 w-3.5 align-text-bottom" /> button next to
					the model selector.
				</p>
				<div className="flex items-center gap-2">
					<Checkbox
						id="dont-show-fast-mode-again"
						checked={dontAskAgain}
						onCheckedChange={(checked) => onDontAskAgainChange(checked === true)}
					/>
					<Label htmlFor="dont-show-fast-mode-again" className="cursor-pointer text-muted-foreground text-sm">
						Don&apos;t ask me again
					</Label>
				</div>
				<DialogFooter>
					<Button variant="secondary" onClick={handleCancel}>
						Cancel{' '}
						<KeyboardShortcut size="xs" className="ml-1">
							Esc
						</KeyboardShortcut>
					</Button>
					<Button
						variant="outline"
						onClick={handleConfirm}
						className="border-[var(--terminal-warning)] text-[var(--terminal-warning)] hover:bg-[var(--terminal-warning)] hover:text-background focus-visible:border-[var(--terminal-warning)] focus-visible:ring-[var(--terminal-warning)]/50"
					>
						Enable Fast Mode
						<KeyboardShortcut size="xs" className="ml-1">
							{typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
								? '⌘+ENTER'
								: 'Ctrl+ENTER'}
						</KeyboardShortcut>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
