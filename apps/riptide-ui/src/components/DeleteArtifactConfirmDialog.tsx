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
import { Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'

export interface DeleteArtifactConfirmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
	onCancel: () => void
	fileName: string
	silenced: boolean
	onSilencedChange: (silenced: boolean) => void
}

export function DeleteArtifactConfirmDialog({
	open,
	onOpenChange,
	onConfirm,
	onCancel,
	fileName,
	silenced: _silenced,
	onSilencedChange,
}: DeleteArtifactConfirmDialogProps) {
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

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-destructive text-base font-bold">
						<Trash2 className="h-4 w-4" />
						Delete Artifact?
					</DialogTitle>
					<DialogDescription>
						<strong>{fileName}</strong> will be moved to trash. You can restore it later.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-center gap-2 py-2">
					<Checkbox
						id="dont-show-delete-again"
						checked={localDontShow}
						onCheckedChange={(checked) => setLocalDontShow(checked === true)}
					/>
					<Label htmlFor="dont-show-delete-again" className="text-sm text-muted-foreground cursor-pointer">
						Don&apos;t ask me again
					</Label>
				</div>

				<DialogFooter className="flex justify-end gap-2 sm:justify-end">
					<Button variant="secondary" onClick={handleCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={handleConfirm}>
						<Trash2 className="h-3 w-3 mr-1" />
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
