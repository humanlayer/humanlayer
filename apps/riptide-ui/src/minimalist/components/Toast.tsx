import { X } from 'lucide-react'
import { useRef } from 'react'

import { useMountEffect } from '@/hooks/useMountEffect'
import { useUi } from '@/minimalist/lib/ui-state'

/** How long a toast stays; one with a button stays longer, so there is time to reach it. */
const SHOW_MS = 5000
const SHOW_WITH_ACTION_MS = 8000

/**
 * The app's one toast. The live region stays mounted so screen readers hear each new
 * message, and the toast waits while the pointer or focus is on it. Every toast can be closed.
 */
export function Toast() {
	const { toast } = useUi()
	return (
		<div role="status" aria-live="polite">
			{toast ? <ToastCard key={toast.id} /> : null}
		</div>
	)
}

function ToastCard() {
	const { toast, dismissToast } = useUi()
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const id = toast?.id ?? 0
	const wait = () => {
		clearTimeout(timer.current)
		timer.current = setTimeout(() => dismissToast(id), toast?.action ? SHOW_WITH_ACTION_MS : SHOW_MS)
	}
	const hold = () => clearTimeout(timer.current)
	useMountEffect(() => {
		wait()
		return hold
	})
	if (!toast) return null
	return (
		<div className="toast" onPointerEnter={hold} onPointerLeave={wait} onFocus={hold} onBlur={wait}>
			{toast.text}
			{toast.action ? (
				<button
					type="button"
					onClick={() => {
						toast.action?.run()
						dismissToast(id)
					}}
				>
					{toast.action.label}
				</button>
			) : null}
			<button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(id)}>
				<X className="i sm" />
			</button>
		</div>
	)
}
