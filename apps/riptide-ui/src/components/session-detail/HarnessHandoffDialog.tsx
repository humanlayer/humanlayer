import { Button } from '@humanlayer/ui/components/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@humanlayer/ui/components/dialog'
import { Label } from '@humanlayer/ui/components/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@humanlayer/ui/components/select'
import { Switch } from '@humanlayer/ui/components/switch'
import { useState } from 'react'

export interface HarnessHandoffDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	targetLabel: string
	modelOptions: ReadonlyArray<{ value: string; label: string }>
	pending: boolean
	onConfirm: (input: { model: string; includeToolCalls: boolean }) => void
}

export function HarnessHandoffDialog({
	open,
	onOpenChange,
	targetLabel,
	modelOptions,
	pending,
	onConfirm,
}: HarnessHandoffDialogProps) {
	const [selectedModel, setSelectedModel] = useState<string | null>(null)
	const [includeToolCalls, setIncludeToolCalls] = useState(true)
	const model = selectedModel ?? modelOptions[0]?.value ?? ''

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent style={{ width: 'min(90%, 34rem)', maxWidth: 'min(90%, 34rem)' }}>
				<DialogHeader>
					<DialogTitle>Hand off to {targetLabel}</DialogTitle>
					<DialogDescription>Continue in a new session with the full conversation.</DialogDescription>
				</DialogHeader>
				<div className="space-y-5 py-2">
					<div className="space-y-2">
						<Label htmlFor="handoff-model">Model</Label>
						<Select value={model} onValueChange={setSelectedModel}>
							<SelectTrigger id="handoff-model" className="w-full">
								<SelectValue placeholder="Select a model" />
							</SelectTrigger>
							<SelectContent>
								{modelOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="border-t border-border pt-4">
						<p className="font-medium">Full conversation</p>
						<p className="text-sm text-muted-foreground">Every user and assistant message, in order.</p>
					</div>
					<div className="flex items-start justify-between gap-4">
						<Label htmlFor="handoff-tool-calls" className="cursor-pointer font-normal">
							Include tool calls and results
							<span className="mt-1 block text-sm text-muted-foreground">
								Commands, file reads, edits, and their output
							</span>
						</Label>
						<Switch
							id="handoff-tool-calls"
							checked={includeToolCalls}
							onCheckedChange={setIncludeToolCalls}
						/>
					</div>
					<div className="rounded-md border border-border p-3">
						<p className="text-sm">Same task, worktree, and shared artifacts</p>
						<p className="mt-1 text-sm text-muted-foreground">
							The source session stays linked. Artifacts are not copied.
						</p>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button disabled={!model || pending} onClick={() => onConfirm({ model, includeToolCalls })}>
						Hand off to {targetLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
