import { type ReactNode, useId, useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { openModal } from '@/minimalist/lib/modal'

/**
 * A modal form: a title, an optional line of description, then the fields and a
 * `dialog-actions` row as children. Escape closes it unless it is `busy` saving, and ⌘Enter
 * submits it from anywhere inside.
 * `error` shows at the bottom and is read out when it appears.
 */
export function Dialog({
	title,
	description,
	busy = false,
	error,
	onClose,
	onSubmit,
	children,
}: {
	title: string
	description?: string
	busy?: boolean
	error?: string | null
	onClose: () => void
	onSubmit: () => void
	children: ReactNode
}) {
	const ref = useRef<HTMLDialogElement>(null)
	const titleId = useId()
	useMountEffect(() => openModal(ref.current))
	return (
		<dialog
			ref={ref}
			className="text-dialog"
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault()
				if (!busy) onClose()
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
				event.preventDefault()
				if (!busy) onSubmit()
			}}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault()
					onSubmit()
				}}
			>
				<h2 id={titleId}>{title}</h2>
				{description ? <p>{description}</p> : null}
				{children}
				<p className="dialog-error" role="alert">
					{error}
				</p>
			</form>
		</dialog>
	)
}
