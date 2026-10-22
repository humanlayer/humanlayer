import { useHotkeys } from '@humanlayer/react-hotkeys-hook'
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
import { AlertTriangle, Send } from 'lucide-react'
import { useCallback, useState } from 'react'

import { HotkeyScopeBoundary } from '@/components/HotkeyScopeBoundary'
import { HOTKEY_SCOPES } from '@/hooks/hotkeys/scopes'

export interface RunningSubAgent {
	id: string
	displayName: string
	description: string
	toolCallCount: number
}

export interface InterruptConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	onCancel: () => void
	runningSubAgents: RunningSubAgent[]
	silenced: boolean
	onSilencedChange: (silenced: boolean) => void
}

export function InterruptConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	onCancel,
	runningSubAgents,
	silenced: _silenced,
	onSilencedChange,
}: InterruptConfirmDialogProps) {
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
		onCancel()
		onOpenChange(false)
		setLocalDontShow(false)
	}, [onCancel, onOpenChange])

	useHotkeys(
		'mod+enter',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleConfirm()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.INTERRUPT_CONFIRM_DIALOG],
		},
		[open, handleConfirm],
	)

	useHotkeys(
		'escape',
		(e) => {
			e.preventDefault()
			e.stopPropagation()
			handleCancel()
		},
		{
			enabled: open,
			enableOnFormTags: true,
			scopes: [HOTKEY_SCOPES.INTERRUPT_CONFIRM_DIALOG],
		},
		[open, handleCancel],
	)

	return (
		<HotkeyScopeBoundary
			scope={HOTKEY_SCOPES.INTERRUPT_CONFIRM_DIALOG}
			isActive={open}
			rootScopeDisabled={true}
			componentName="InterruptConfirmDialog"
		>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					className="overflow-hidden"
					style={{ width: 'min(90%, 42rem)', maxWidth: 'min(90%, 42rem)' }}
					onEscapeKeyDown={(e) => e.preventDefault()}
					onPointerDownOutside={(e) => e.preventDefault()}
				>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2 text-destructive text-base font-bold">
							<AlertTriangle className="h-4 w-4" />
							Interrupt {runningSubAgents.length} Running Sub-Agent
							{runningSubAgents.length !== 1 ? 's' : ''}?
						</DialogTitle>
						<DialogDescription asChild>
							<div className="space-y-2">
								<p>
									Interrupting will stop the following sub-agents. Running sub-agents cannot be
									resumed once interrupted.
								</p>
							</div>
						</DialogDescription>
					</DialogHeader>

					<div className="max-h-48 overflow-y-auto space-y-2 rounded-md border p-2">
						{runningSubAgents.map((agent) => (
							<div
								key={agent.id}
								className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-sm bg-muted/50"
							>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-sm">{agent.displayName}</div>
									{agent.description && (
										<div className="text-sm text-muted-foreground truncate">
											{agent.description}
										</div>
									)}
								</div>
								<span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
									{agent.toolCallCount} tool call{agent.toolCallCount !== 1 ? 's' : ''}
								</span>
							</div>
						))}
					</div>

					<div className="flex items-center gap-2 py-2">
						<Checkbox
							id="dont-show-interrupt-again"
							checked={localDontShow}
							onCheckedChange={(checked) => {
								setLocalDontShow(checked === true)
								if (checked) {
									onSilencedChange(true)
								}
							}}
						/>
						<Label
							htmlFor="dont-show-interrupt-again"
							className="text-sm text-muted-foreground cursor-pointer"
						>
							Don&apos;t ask me again
						</Label>
					</div>

					<DialogFooter className="flex justify-end gap-2 sm:justify-end">
						<Button variant="secondary" onClick={handleCancel}>
							Cancel
							<KeyboardShortcut size="xs" className="ml-1">
								Esc
							</KeyboardShortcut>
						</Button>
						<Button variant="default" onClick={handleConfirm}>
							<Send className="h-3 w-3 mr-1" />
							Interrupt & Send
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
