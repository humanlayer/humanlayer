import { useState } from 'react'

import { Dialog } from '@/minimalist/components/Dialog'
import { useAction } from '@/minimalist/lib/use-action'

export function TextDialog({
	title,
	initialValue,
	submitLabel,
	description,
	multiline = false,
	onSave,
	onClose,
}: {
	title: string
	initialValue: string
	submitLabel: string
	description?: string
	multiline?: boolean
	onSave: (value: string) => Promise<unknown>
	onClose: () => void
}) {
	const [value, setValue] = useState(initialValue)
	const action = useAction('inline')
	return (
		<Dialog
			title={title}
			description={description}
			busy={action.pending}
			error={action.error}
			onClose={onClose}
			onSubmit={() => {
				if (!value.trim()) return
				void action
					.run(() => onSave(value.trim()), 'Could not save changes. Your text is still here. Try again.')
					.then((saved) => {
						if (saved) onClose()
					})
			}}
		>
			{multiline ? (
				<textarea
					aria-label={title}
					autoFocus
					rows={5}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					disabled={action.pending}
				/>
			) : (
				<input
					aria-label={title}
					autoFocus
					value={value}
					onChange={(event) => setValue(event.target.value)}
					disabled={action.pending}
				/>
			)}
			<div className="dialog-actions">
				<button type="button" className="btn" onClick={onClose} disabled={action.pending}>
					Cancel
				</button>
				<button type="submit" className="btn primary" disabled={action.pending || !value.trim()}>
					{action.pending ? 'Saving…' : submitLabel}
				</button>
			</div>
		</Dialog>
	)
}
